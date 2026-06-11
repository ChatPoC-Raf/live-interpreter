import { describe, expect, it } from 'vitest';
import { base64ToInt16, int16ToBase64 } from './wsClient';

describe('konwersje PCM <-> base64', () => {
  it('roundtrip zachowuje probki', () => {
    const pcm = new Int16Array([0, 1, -1, 32767, -32768, 12345]);
    expect(Array.from(base64ToInt16(int16ToBase64(pcm)))).toEqual(Array.from(pcm));
  });

  it('dziala dla duzych buforow (chunkowanie btoa)', () => {
    const pcm = new Int16Array(100000);
    for (let i = 0; i < pcm.length; i++) pcm[i] = (i % 65536) - 32768;
    const decoded = base64ToInt16(int16ToBase64(pcm));
    expect(decoded.length).toBe(pcm.length);
    expect(decoded[99999]).toBe(pcm[99999]);
  });

  it('pusty bufor -> pusty wynik', () => {
    expect(base64ToInt16(int16ToBase64(new Int16Array(0))).length).toBe(0);
  });
});
