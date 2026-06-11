import { describe, expect, it } from 'vitest';
import { buildWavHeader, WAV_HEADER_BYTES, wavSizesForFileLength } from './wav';

describe('buildWavHeader', () => {
  it('buduje poprawny naglowek PCM 16k mono', () => {
    const h = buildWavHeader(16000, 1000);
    expect(h.byteLength).toBe(WAV_HEADER_BYTES);
    expect(h.toString('ascii', 0, 4)).toBe('RIFF');
    expect(h.readUInt32LE(4)).toBe(36 + 1000);
    expect(h.toString('ascii', 8, 12)).toBe('WAVE');
    expect(h.readUInt16LE(20)).toBe(1); // PCM
    expect(h.readUInt16LE(22)).toBe(1); // mono
    expect(h.readUInt32LE(24)).toBe(16000);
    expect(h.readUInt32LE(28)).toBe(32000); // byte rate
    expect(h.readUInt32LE(40)).toBe(1000);
  });

  it('placeholder z dataBytes=0 dla zapisu strumieniowego', () => {
    const h = buildWavHeader(24000, 0);
    expect(h.readUInt32LE(4)).toBe(36);
    expect(h.readUInt32LE(40)).toBe(0);
  });
});

describe('wavSizesForFileLength', () => {
  it('wylicza rozmiary z dlugosci pliku', () => {
    expect(wavSizesForFileLength(44 + 500)).toEqual({ riffSize: 536, dataSize: 500 });
  });

  it('plik krotszy niz naglowek -> dataSize 0 (uszkodzony, ale nie ujemny)', () => {
    expect(wavSizesForFileLength(10)).toEqual({ riffSize: 36, dataSize: 0 });
  });
});
