// Pipeline segmentu po COMMIT: STT.commit -> filtry -> MT stream -> zdania
// do TTS (flush per zdanie) -> chunki audio do playbacku + artefakty.
// AbortSignal przerywa kazdy etap. Dokladnie 1 pipeline na raz (inwariant maszyny).
import { PipelineError, toPipelineError } from '../core/errors';
import type { SttSession, TranslationProvider, TtsProvider } from '../providers/types';
import type { LatencyMeter } from './latency';
import type { PlaybackSink } from './playbackQueue';
import { SentenceChunker } from './sentenceChunker';

export interface SegmentResult {
  kind: 'done';
  originalText: string;
  translatedText: string;
  sourceLang: string | null;
  /** Zlepione PCM 24k calego tlumaczenia — do artefaktow i POWTORZ. */
  ttsPcm: Int16Array;
}

export interface SegmentFiltered {
  kind: 'filtered';
  reason: 'empty' | 'target_lang';
  originalText: string;
  sourceLang: string | null;
}

export type SegmentOutcome = SegmentResult | SegmentFiltered;

export interface SegmentPipelineDeps {
  stt: SttSession;
  translation: TranslationProvider;
  tts: TtsProvider;
  playback: PlaybackSink;
  voiceId: string;
  targetLang: string;
  sourceLang: string | null;
  context: { original: string; translated: string }[];
  meter: LatencyMeter;
  now: () => number;
  onTranslationDelta?: (full: string) => void;
}

/**
 * Tlumaczenie z JUZ zacommitowanego tekstu (retry po awarii) — pomija STT.
 */
export async function translateAndSpeak(
  deps: Omit<SegmentPipelineDeps, 'stt'>,
  originalText: string,
  sourceLang: string | null,
  signal: AbortSignal,
): Promise<SegmentResult> {
  const { translation, tts, playback, meter, now } = deps;
  const chunker = new SentenceChunker();
  const collected: Int16Array[] = [];
  let translated = '';

  const ttsSession = await tts.startSession({
    voiceId: deps.voiceId,
    signal,
    onAudio: (pcm) => {
      meter.mark('ttsFirstAudio', now());
      collected.push(pcm);
      playback.enqueue(pcm);
    },
  });

  try {
    const stream = translation.translateStream({
      text: originalText,
      sourceLang,
      targetLang: deps.targetLang,
      context: deps.context,
      signal,
    });
    for await (const token of stream) {
      if (signal.aborted) throw new PipelineError('transient', 'mt', 'aborted', 'Przerwano');
      meter.mark('mtFirstToken', now());
      translated += token;
      deps.onTranslationDelta?.(translated);
      for (const sentence of chunker.push(token)) {
        ttsSession.sendText(sentence + ' ', true);
      }
    }
    const rest = chunker.flushRemainder();
    if (rest) ttsSession.sendText(rest + ' ', true);
    ttsSession.endInput();
    await ttsSession.done;
    playback.end();
  } catch (err) {
    ttsSession.close();
    playback.stop();
    throw toPipelineError('mt', err);
  }

  return {
    kind: 'done',
    originalText,
    translatedText: translated.trim(),
    sourceLang,
    ttsPcm: mergePcm(collected),
  };
}

/**
 * Pelny przebieg segmentu: commit STT -> filtry -> tlumaczenie + synteza.
 */
export async function runSegment(
  deps: SegmentPipelineDeps,
  signal: AbortSignal,
): Promise<SegmentOutcome> {
  const final = await deps.stt.commit();
  deps.meter.mark('sttFinal', deps.now());

  const text = final.text.trim();
  if (text.length === 0) {
    return { kind: 'filtered', reason: 'empty', originalText: '', sourceLang: final.language };
  }
  // Segment juz w jezyku docelowym — pomijamy playback (adnotacja w feedzie).
  if (final.language !== null && normalizeLang(final.language) === normalizeLang(deps.targetLang)) {
    return {
      kind: 'filtered',
      reason: 'target_lang',
      originalText: text,
      sourceLang: final.language,
    };
  }
  return translateAndSpeak(deps, text, final.language ?? deps.sourceLang, signal);
}

export function normalizeLang(lang: string): string {
  return lang.toLowerCase().split(/[-_]/)[0];
}

export function mergePcm(chunks: Int16Array[]): Int16Array {
  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const out = new Int16Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
