// Testy pipeline'u segmentu na fake'owych providerach: happy path, filtry,
// abort w trakcie MT, scalanie PCM, flush per zdanie.
import { describe, expect, it } from 'vitest';
import type {
  SttFinal,
  SttSession,
  TranslationProvider,
  TranslationRequest,
  TtsProvider,
  TtsSession,
} from '../providers/types';
import { LatencyMeter } from './latency';
import type { PlaybackSink } from './playbackQueue';
import { mergePcm, normalizeLang, runSegment, type SegmentPipelineDeps } from './segmentPipeline';

function fakeStt(final: SttFinal): SttSession {
  return {
    sendAudio: () => undefined,
    commit: async () => final,
    close: () => undefined,
  };
}

function fakeTranslation(tokens: string[], onRequest?: (r: TranslationRequest) => void): TranslationProvider {
  return {
     
    async *translateStream(req) {
      onRequest?.(req);
      for (const t of tokens) {
        if (req.signal.aborted) return;
        yield t;
      }
    },
  };
}

interface FakeTts {
  provider: TtsProvider;
  sent: { text: string; flush: boolean }[];
  closed: boolean;
}

function fakeTts(audioPerFlush: Int16Array): FakeTts {
  const state: FakeTts = { provider: null as unknown as TtsProvider, sent: [], closed: false };
  state.provider = {
    startSession: async (opts) => {
      const session: TtsSession = {
        sendText: (text, flush) => {
          state.sent.push({ text, flush });
          if (flush) opts.onAudio(audioPerFlush);
        },
        endInput: () => undefined,
        close: () => {
          state.closed = true;
        },
        done: Promise.resolve(),
      };
      return session;
    },
  };
  return state;
}

function fakeSink(): PlaybackSink & { chunks: Int16Array[]; endedCount: number; stopped: boolean } {
  const sink = {
    chunks: [] as Int16Array[],
    endedCount: 0,
    stopped: false,
    enqueue(pcm: Int16Array) {
      sink.chunks.push(pcm);
    },
    end() {
      sink.endedCount += 1;
    },
    stop() {
      sink.stopped = true;
    },
  };
  return sink;
}

function deps(over: Partial<SegmentPipelineDeps>): SegmentPipelineDeps {
  let t = 0;
  return {
    stt: fakeStt({ text: 'dzien dobry panstwu. milo was widziec.', language: 'pl' }),
    translation: fakeTranslation(['Good morning. ', 'Nice to ', 'see you.']),
    tts: fakeTts(new Int16Array([1, 2, 3])).provider,
    playback: fakeSink(),
    voiceId: 'v1',
    targetLang: 'en',
    sourceLang: null,
    context: [],
    meter: new LatencyMeter(),
    now: () => (t += 10),
    ...over,
  };
}

describe('runSegment — happy path', () => {
  it('zwraca oryginal + tlumaczenie + zlepione PCM', async () => {
    const sink = fakeSink();
    const tts = fakeTts(new Int16Array([7, 7]));
    const result = await runSegment(
      deps({ playback: sink, tts: tts.provider }),
      new AbortController().signal,
    );
    expect(result.kind).toBe('done');
    if (result.kind !== 'done') return;
    expect(result.originalText).toContain('dzien dobry');
    expect(result.translatedText).toBe('Good morning. Nice to see you.');
    expect(result.sourceLang).toBe('pl');
    expect(sink.chunks.length).toBeGreaterThan(0);
    expect(sink.endedCount).toBe(1);
    expect(Array.from(result.ttsPcm.slice(0, 2))).toEqual([7, 7]);
  });

  it('zdania ida do TTS z flush=true (granice zdan, nie tokeny)', async () => {
    const tts = fakeTts(new Int16Array([1]));
    await runSegment(deps({ tts: tts.provider }), new AbortController().signal);
    const flushed = tts.sent.filter((s) => s.flush).map((s) => s.text.trim());
    expect(flushed).toEqual(['Good morning.', 'Nice to see you.']);
  });

  it('mierzy etapy latencji (sttFinal/mtFirstToken/ttsFirstAudio)', async () => {
    const meter = new LatencyMeter();
    await runSegment(deps({ meter }), new AbortController().signal);
    expect(meter.spanMs('sttFinal', 'mtFirstToken')).not.toBeNull();
    expect(meter.spanMs('mtFirstToken', 'ttsFirstAudio')).not.toBeNull();
  });
});

describe('runSegment — filtry przed MT', () => {
  it('pusty transkrypt -> filtered empty (bez wolania MT/TTS)', async () => {
    let mtCalled = false;
    const result = await runSegment(
      deps({
        stt: fakeStt({ text: '   ', language: 'pl' }),
        translation: fakeTranslation([], () => {
          mtCalled = true;
        }),
      }),
      new AbortController().signal,
    );
    expect(result).toMatchObject({ kind: 'filtered', reason: 'empty' });
    expect(mtCalled).toBe(false);
  });

  it('segment juz w jezyku docelowym -> filtered target_lang z adnotacja', async () => {
    const result = await runSegment(
      deps({ stt: fakeStt({ text: 'this is already english', language: 'en' }) }),
      new AbortController().signal,
    );
    expect(result).toMatchObject({ kind: 'filtered', reason: 'target_lang' });
    if (result.kind === 'filtered') {
      expect(result.originalText).toBe('this is already english');
    }
  });

  it('warianty regionalne (en-US vs en) tez sa filtrowane', async () => {
    const result = await runSegment(
      deps({ stt: fakeStt({ text: 'hello', language: 'en-US' }) }),
      new AbortController().signal,
    );
    expect(result).toMatchObject({ kind: 'filtered', reason: 'target_lang' });
  });
});

describe('runSegment — abort i bledy', () => {
  it('abort w trakcie MT zamyka TTS i zatrzymuje playback', async () => {
    const ctrl = new AbortController();
    const tts = fakeTts(new Int16Array([1]));
    const sink = fakeSink();
    const translation: TranslationProvider = {
       
      async *translateStream(req) {
        yield 'Pierwsze zdanie. ';
        ctrl.abort(); // abort w polowie strumienia
        if (req.signal.aborted) {
          throw new DOMException('aborted', 'AbortError');
        }
        yield 'nigdy';
      },
    };
    await expect(
      runSegment(deps({ translation, tts: tts.provider, playback: sink }), ctrl.signal),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(tts.closed).toBe(true);
    expect(sink.stopped).toBe(true);
  });

  it('blad MT propaguje jako PipelineError po sprzatnieciu', async () => {
    const tts = fakeTts(new Int16Array([1]));
    const translation: TranslationProvider = {
      // eslint-disable-next-line require-yield
      async *translateStream() {
        throw new Error('boom z sieci');
      },
    };
    await expect(
      runSegment(deps({ translation, tts: tts.provider }), new AbortController().signal),
    ).rejects.toMatchObject({ kind: 'transient' });
    expect(tts.closed).toBe(true);
  });
});

describe('pomocnicze', () => {
  it('mergePcm skleja chunki w kolejnosci', () => {
    const merged = mergePcm([new Int16Array([1, 2]), new Int16Array([3]), new Int16Array([4, 5])]);
    expect(Array.from(merged)).toEqual([1, 2, 3, 4, 5]);
  });

  it('normalizeLang redukuje warianty regionalne', () => {
    expect(normalizeLang('en-US')).toBe('en');
    expect(normalizeLang('PL')).toBe('pl');
    expect(normalizeLang('pt_BR')).toBe('pt');
  });
});
