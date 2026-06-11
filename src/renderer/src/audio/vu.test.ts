import { describe, expect, it } from 'vitest';
import { hasClipping, rms, rmsToDbfs, vuPercent } from './vu';

describe('rms', () => {
  it('cisza -> 0', () => {
    expect(rms(new Float32Array(100))).toBe(0);
  });

  it('staly sygnal 0.5 -> 0.5', () => {
    expect(rms(new Float32Array(100).fill(0.5))).toBeCloseTo(0.5, 5);
  });

  it('pusta tablica -> 0 (bez NaN)', () => {
    expect(rms(new Float32Array(0))).toBe(0);
  });
});

describe('rmsToDbfs', () => {
  it('pelna skala -> 0 dBFS', () => {
    expect(rmsToDbfs(1)).toBeCloseTo(0, 5);
  });

  it('0.1 -> -20 dBFS', () => {
    expect(rmsToDbfs(0.1)).toBeCloseTo(-20, 3);
  });

  it('zero -> podloga -90 (bez -Infinity)', () => {
    expect(rmsToDbfs(0)).toBe(-90);
  });
});

describe('vuPercent', () => {
  it('cisza -> 0%, pelna skala -> 100%', () => {
    expect(vuPercent(0)).toBe(0);
    expect(vuPercent(1)).toBe(100);
  });

  it('-30 dBFS -> ~50%', () => {
    expect(vuPercent(Math.pow(10, -30 / 20))).toBeCloseTo(50, 0);
  });
});

describe('hasClipping', () => {
  it('wykrywa probki przy pelnej skali', () => {
    const s = new Float32Array(10);
    s[4] = 0.999;
    expect(hasClipping(s)).toBe(true);
  });

  it('nie flaguje zdrowego sygnalu', () => {
    expect(hasClipping(new Float32Array(10).fill(0.7))).toBe(false);
  });
});
