// Doszkalanie klonu glosu W TRAKCIE wystapienia: zbiera czysta mowe mowcy
// (tylko fazy z otwarta brama mikrofonu — zero przebic z PA), tnie na tury,
// a gdy uzbiera sie wystarczajaco swiezego materialu, partia idzie do
// ElevenLabs edit-voice (VoicesProvider.addSamples). Czysty TS — bez IO.

export const VOICE_IMPROVE = {
  sampleRate: 16_000,
  /** Tura krotsza niz to = prawdopodobnie smiec (stukniecie, "yhm") — odpada. */
  minTakeSec: 3,
  /** Minimum swiezej mowy zanim oplaca sie doszkolic klon. */
  minBatchSec: 60,
  /** Gorny limit partii (najstarsze tury wypadaja) — male payloady, swiezy material. */
  maxBatchSec: 120,
  /** Odstep miedzy doszkoleniami — nie mlocic API co segment. */
  cooldownMs: 240_000,
  /** Limit doszkolen na sesje (IVC ma limit ~25 sampli na glos). */
  maxUploads: 5,
} as const;

export class VoiceImprover {
  private enabled = false;
  private takeChunks: Int16Array[] | null = null;
  private takeSamples = 0;
  private batch: Int16Array[] = [];
  private batchTakeSamples: number[] = [];
  private batchSamples = 0;
  private uploads = 0;
  private lastUploadAt = Number.NEGATIVE_INFINITY;
  private inFlight = false;

  /** Start sesji — czysty stan + decyzja czy funkcja wlaczona. */
  reset(enabled: boolean): void {
    this.enabled = enabled;
    this.takeChunks = null;
    this.takeSamples = 0;
    this.batch = [];
    this.batchTakeSamples = [];
    this.batchSamples = 0;
    this.uploads = 0;
    this.lastUploadAt = Number.NEGATIVE_INFINITY;
    this.inFlight = false;
  }

  /** Mowca zaczal mowic (speech_start) — otwarcie nowej tury. */
  beginTake(): void {
    if (!this.enabled) return;
    this.takeChunks = [];
    this.takeSamples = 0;
  }

  /** PCM 16 kHz z mikrofonu — TYLKO przy otwartej bramie (SLUCHAM/DOMYKANIE). */
  feed(pcm: Int16Array): void {
    if (!this.enabled || this.takeChunks === null) return;
    this.takeChunks.push(pcm.slice());
    this.takeSamples += pcm.length;
  }

  /** Tura domknieta (commit) — material trafia do partii, jesli niesmieciowy. */
  commitTake(): void {
    if (this.takeChunks === null) return;
    const minSamples = VOICE_IMPROVE.minTakeSec * VOICE_IMPROVE.sampleRate;
    if (this.takeSamples >= minSamples) {
      const take = concat(this.takeChunks, this.takeSamples);
      this.batch.push(take);
      this.batchTakeSamples.push(take.length);
      this.batchSamples += take.length;
      this.trimBatch();
    }
    this.takeChunks = null;
    this.takeSamples = 0;
  }

  /** Falstart VAD (speech_misfire) — tura odpada w calosci. */
  discardTake(): void {
    this.takeChunks = null;
    this.takeSamples = 0;
  }

  get batchSeconds(): number {
    return this.batchSamples / VOICE_IMPROVE.sampleRate;
  }

  /** Czy teraz jest dobry moment na doszkolenie (po segment_done). */
  shouldUpload(now: number): boolean {
    return (
      this.enabled &&
      !this.inFlight &&
      this.uploads < VOICE_IMPROVE.maxUploads &&
      this.batchSeconds >= VOICE_IMPROVE.minBatchSec &&
      now - this.lastUploadAt >= VOICE_IMPROVE.cooldownMs
    );
  }

  /** Na koniec sesji: resztka materialu warta wyslania (bez cooldownu). */
  hasFinalBatch(): boolean {
    return (
      this.enabled &&
      !this.inFlight &&
      this.uploads < VOICE_IMPROVE.maxUploads &&
      this.batchSeconds >= VOICE_IMPROVE.minBatchSec
    );
  }

  /** Pobiera partie do wysylki (czysci bufor, blokuje rownolegle wysylki). */
  beginUpload(): Int16Array | null {
    if (this.inFlight || this.batchSamples === 0) return null;
    const pcm = concat(this.batch, this.batchSamples);
    this.batch = [];
    this.batchTakeSamples = [];
    this.batchSamples = 0;
    this.inFlight = true;
    return pcm;
  }

  /** Wynik wysylki. Porazka NIE odzyskuje partii (material plynie dalej) — tylko backoff. */
  finishUpload(ok: boolean, now: number): void {
    this.inFlight = false;
    this.lastUploadAt = now;
    if (ok) this.uploads += 1;
  }

  private trimBatch(): void {
    const maxSamples = VOICE_IMPROVE.maxBatchSec * VOICE_IMPROVE.sampleRate;
    while (this.batch.length > 1 && this.batchSamples > maxSamples) {
      this.batch.shift();
      this.batchSamples -= this.batchTakeSamples.shift() ?? 0;
    }
  }
}

function concat(chunks: Int16Array[], total: number): Int16Array {
  const out = new Int16Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** PCM 16-bit mono -> WAV Blob (naglowek RIFF 44 B) — format akceptowany przez IVC. */
export function pcm16ToWavBlob(pcm: Int16Array, sampleRate: number): Blob {
  const dataBytes = pcm.length * 2;
  const out = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(out);
  writeAscii(v, 0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  writeAscii(v, 8, 'WAVE');
  writeAscii(v, 12, 'fmt ');
  v.setUint32(16, 16, true); // rozmiar chunku fmt
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bity na sample
  writeAscii(v, 36, 'data');
  v.setUint32(40, dataBytes, true);
  new Int16Array(out, 44).set(pcm); // platformy x86/ARM = little-endian, jak wymaga WAV
  return new Blob([out], { type: 'audio/wav' });
}

function writeAscii(v: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) v.setUint8(offset + i, text.charCodeAt(i));
}
