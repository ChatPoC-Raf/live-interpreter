// Kolejka odtwarzania PCM 24 kHz: chunki TTS schedulowane bezszwowo
// (AudioBufferSourceNode back-to-back). Czysta arytmetyka w PlaybackScheduler.

export function int16ToFloat32(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 0x8000;
  return out;
}

/** Czysta logika harmonogramu: kiedy startowac kolejny chunk. */
export class PlaybackScheduler {
  private nextStartTime = 0;

  /** Zwraca czas startu chunka o dlugosci durationSec przy zegarze currentTime. */
  schedule(currentTime: number, durationSec: number): number {
    const start = Math.max(currentTime, this.nextStartTime);
    this.nextStartTime = start + durationSec;
    return start;
  }

  reset(): void {
    this.nextStartTime = 0;
  }

  get queuedUntil(): number {
    return this.nextStartTime;
  }
}

export interface PlaybackSink {
  enqueue(pcm24k: Int16Array): void;
  /** Koniec chunkow — onDrained odpali sie po dograniu ostatniego. */
  end(): void;
  stop(): void;
}

const SAMPLE_RATE = 24000;

export class PlaybackQueue implements PlaybackSink {
  private scheduler = new PlaybackScheduler();
  private pending = 0;
  private ended = false;
  private stopped = false;
  private sources = new Set<AudioBufferSourceNode>();
  private firstAudioFired = false;

  onFirstAudio: (() => void) | null = null;
  onDrained: (() => void) | null = null;

  constructor(
    private readonly ctx: AudioContext,
    private readonly destination: AudioNode,
  ) {}

  enqueue(pcm24k: Int16Array): void {
    if (this.stopped || pcm24k.length === 0) return;
    const float = int16ToFloat32(pcm24k);
    const buffer = this.ctx.createBuffer(1, float.length, SAMPLE_RATE);
    buffer.copyToChannel(float, 0);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.destination);
    const start = this.scheduler.schedule(this.ctx.currentTime, buffer.duration);
    this.pending += 1;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      this.pending -= 1;
      if (this.ended && this.pending === 0 && !this.stopped) {
        this.onDrained?.();
      }
    };
    source.start(start);
    if (!this.firstAudioFired) {
      this.firstAudioFired = true;
      this.onFirstAudio?.();
    }
  }

  end(): void {
    this.ended = true;
    if (this.pending === 0 && !this.stopped) {
      this.onDrained?.();
    }
  }

  stop(): void {
    this.stopped = true;
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        // juz zatrzymany — ignorujemy
      }
    }
    this.sources.clear();
    this.pending = 0;
  }
}
