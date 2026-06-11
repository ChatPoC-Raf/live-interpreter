// Czysta logika wokol VAD — testowana jednostkowo bez onnxruntime.

export type PauseTrackerEvent = 'provisional_pause' | 'resumed' | null;

/**
 * Sledzi prawdopodobienstwa mowy ramka-po-ramce i emituje:
 *  - 'provisional_pause' — pierwsza cicha ramka po mowie (start okna DOMYKANIE)
 *  - 'resumed'           — mowa wrocila zanim VAD domknal segment (falszywa pauza)
 * Definitywny koniec segmentu (COMMIT) emituje sam VAD przez onSpeechEnd.
 */
export class PauseTracker {
  private speaking = false;
  private inProvisionalPause = false;

  constructor(
    private readonly positiveThreshold: number,
    private readonly negativeThreshold: number,
  ) {}

  feed(speechProbability: number): PauseTrackerEvent {
    if (speechProbability >= this.positiveThreshold) {
      if (this.inProvisionalPause) {
        this.inProvisionalPause = false;
        return 'resumed';
      }
      this.speaking = true;
      return null;
    }
    if (speechProbability < this.negativeThreshold && this.speaking && !this.inProvisionalPause) {
      this.inProvisionalPause = true;
      return 'provisional_pause';
    }
    return null;
  }

  /** Po COMMIT / misfire / gate — segment domkniety, zaczynamy od zera. */
  reset(): void {
    this.speaking = false;
    this.inProvisionalPause = false;
  }
}

/**
 * Detekcja barge-in: mowca mowi przy ZAMKNIETEJ bramie (TLUMACZE/ODTWARZAM).
 * Wymaga utrzymania energii powyzej progu przez sustainMs — pojedynczy trzask
 * nie alarmuje. Jeden alarm na okres zamkniecia bramy.
 */
export class BargeInDetector {
  private aboveSince: number | null = null;
  private fired = false;

  constructor(
    private readonly threshold: number,
    private readonly sustainMs: number,
  ) {}

  feed(rmsValue: number, nowMs: number): boolean {
    if (rmsValue < this.threshold) {
      this.aboveSince = null;
      return false;
    }
    if (this.aboveSince === null) this.aboveSince = nowMs;
    if (!this.fired && nowMs - this.aboveSince >= this.sustainMs) {
      this.fired = true;
      return true;
    }
    return false;
  }

  reset(): void {
    this.aboveSince = null;
    this.fired = false;
  }
}
