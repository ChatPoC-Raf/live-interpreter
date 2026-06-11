// Pomiar latencji per segment: pauza -> pierwszy dzwiek, z rozbiciem na etapy.

export type LatencyStage =
  | 'pauseDetected' // VAD: koniec tury (COMMIT)
  | 'sttFinal' // finalny transkrypt
  | 'mtFirstToken' // pierwszy token tlumaczenia
  | 'ttsFirstAudio' // pierwszy chunk audio z TTS
  | 'playbackStart'; // start odtwarzania

export class LatencyMeter {
  private marks = new Map<LatencyStage, number>();

  mark(stage: LatencyStage, timeMs: number): void {
    if (!this.marks.has(stage)) this.marks.set(stage, timeMs);
  }

  spanMs(from: LatencyStage, to: LatencyStage): number | null {
    const a = this.marks.get(from);
    const b = this.marks.get(to);
    return a !== undefined && b !== undefined ? b - a : null;
  }

  /** Latencja uzytkowa: pauza mowcy -> pierwszy dzwiek tlumaczenia. */
  totalMs(): number | null {
    return this.spanMs('pauseDetected', 'playbackStart');
  }

  breakdown(): Record<string, number | null> {
    return {
      stt: this.spanMs('pauseDetected', 'sttFinal'),
      mt: this.spanMs('sttFinal', 'mtFirstToken'),
      tts: this.spanMs('mtFirstToken', 'ttsFirstAudio'),
      playback: this.spanMs('ttsFirstAudio', 'playbackStart'),
      total: this.totalMs(),
    };
  }
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)];
}
