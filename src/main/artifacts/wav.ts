// Naglowki WAV (PCM 16-bit mono) — czysta logika, testowana jednostkowo.
// Strategia append-only: naglowek z placeholderami rozmiaru, dane dopisywane,
// finalize/recovery latają rozmiary na podstawie faktycznej dlugosci pliku.

export const WAV_HEADER_BYTES = 44;

export function buildWavHeader(sampleRate: number, dataBytes: number): Buffer {
  const buf = Buffer.alloc(WAV_HEADER_BYTES);
  const byteRate = sampleRate * 2; // mono, 16 bit
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}

/** Wylicza poprawione pola rozmiaru dla pliku WAV o znanej dlugosci calkowitej. */
export function wavSizesForFileLength(fileBytes: number): {
  riffSize: number;
  dataSize: number;
} {
  const dataSize = Math.max(0, fileBytes - WAV_HEADER_BYTES);
  return { riffSize: 36 + dataSize, dataSize };
}
