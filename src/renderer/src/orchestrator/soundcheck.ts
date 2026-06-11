// Pomiary soundchecku: poziom/szum sali, przesluch PA->mik (kalibracja progu
// barge-in), segment testowy E2E z pomiarem latencji.
import type { AudioEngine } from '../audio/audioEngine';
import { createProviders } from '../providers/factory';
import { LatencyMeter } from './latency';
import { PlaybackQueue } from './playbackQueue';
import { translateAndSpeak } from './segmentPipeline';

/** Czysta kalibracja progu barge-in z pomiarow. */
export function proposeBargeInThreshold(noiseRms: number, crosstalkRms: number): number {
  // Prog musi byc PONAD przesluchem PA->mik (zeby playback nie alarmowal sam siebie)
  // i wyraznie ponad szumem sali; minimum 0.03 chroni przed zerowymi pomiarami.
  return Math.max(crosstalkRms * 2.5, noiseRms * 4, 0.03);
}

/** Zbiera poziomy RMS z wejscia przez podany czas. */
export function collectLevels(engine: AudioEngine, ms: number): Promise<number[]> {
  return new Promise((resolve) => {
    const levels: number[] = [];
    const unsub = engine.onInputLevel((rms) => levels.push(rms));
    setTimeout(() => {
      unsub();
      resolve(levels);
    }, ms);
  });
}

export function avg(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

export function peak(values: number[]): number {
  return values.length ? Math.max(...values) : 0;
}

export async function measureNoiseFloor(engine: AudioEngine, ms = 3000): Promise<number> {
  return avg(await collectLevels(engine, ms));
}

/** Gra ton przez PA i mierzy ile wraca do mikrofonu (przesluch). */
export async function measureCrosstalk(engine: AudioEngine, ms = 2000): Promise<number> {
  const tonePromise = engine.playTestTone(440, ms);
  const levels = await collectLevels(engine, ms);
  await tonePromise;
  return peak(levels);
}

export interface E2ECheckResult {
  ok: boolean;
  totalMs: number | null;
  breakdown: Record<string, number | null>;
  translatedText: string;
  error?: string;
}

/** Segment testowy E2E: tekst -> MT -> TTS (klon) -> playback przez PA. */
export async function runE2ECheck(
  engine: AudioEngine,
  opts: { voiceId: string; targetLang: string; llmProvider: 'gemini' | 'anthropic' },
): Promise<E2ECheckResult> {
  const secrets = await window.live.getSecrets();
  if (!secrets.elevenKey || !secrets.llmKey) {
    return { ok: false, totalMs: null, breakdown: {}, translatedText: '', error: 'Brak kluczy API' };
  }
  const ctx = engine.getOutputContext();
  const gain = engine.getOutputGainNode();
  if (!ctx || !gain) {
    return { ok: false, totalMs: null, breakdown: {}, translatedText: '', error: 'Wyjscie audio nie uruchomione' };
  }
  const providers = createProviders({
    elevenKey: secrets.elevenKey,
    llmKey: secrets.llmKey,
    llmProvider: opts.llmProvider,
  });
  const meter = new LatencyMeter();
  const playback = new PlaybackQueue(ctx, gain);
  const drained = new Promise<void>((r) => {
    playback.onDrained = r;
  });
  playback.onFirstAudio = () => meter.mark('playbackStart', performance.now());
  meter.mark('pauseDetected', performance.now());
  meter.mark('sttFinal', performance.now()); // tekstowy test — STT pomijamy
  try {
    const result = await translateAndSpeak(
      {
        translation: providers.translation,
        tts: providers.tts,
        playback,
        voiceId: opts.voiceId,
        targetLang: opts.targetLang,
        sourceLang: 'pl',
        context: [],
        meter,
        now: () => performance.now(),
      },
      'To jest segment testowy soundchecku. Jesli go slychac, tor dziala poprawnie.',
      'pl',
      new AbortController().signal,
    );
    await drained;
    return {
      ok: true,
      totalMs: meter.totalMs(),
      breakdown: meter.breakdown(),
      translatedText: result.translatedText,
    };
  } catch (e) {
    playback.stop();
    return {
      ok: false,
      totalMs: null,
      breakdown: meter.breakdown(),
      translatedText: '',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
