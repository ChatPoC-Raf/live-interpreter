import { describe, expect, it } from 'vitest';
import { avg, peak, proposeBargeInThreshold } from './soundcheck';

describe('proposeBargeInThreshold', () => {
  it('prog ponad przesluchem PA->mik (x2.5)', () => {
    expect(proposeBargeInThreshold(0.005, 0.04)).toBeCloseTo(0.1, 5);
  });

  it('prog ponad szumem sali (x4) gdy przesluch maly', () => {
    expect(proposeBargeInThreshold(0.02, 0.001)).toBeCloseTo(0.08, 5);
  });

  it('minimum 0.03 przy zerowych pomiarach (mikrofon wyciszony w tescie)', () => {
    expect(proposeBargeInThreshold(0, 0)).toBe(0.03);
  });
});

describe('statystyki pomiarow', () => {
  it('avg i peak', () => {
    expect(avg([0.1, 0.2, 0.3])).toBeCloseTo(0.2, 5);
    expect(peak([0.1, 0.5, 0.2])).toBe(0.5);
  });

  it('puste pomiary -> 0 (bez NaN)', () => {
    expect(avg([])).toBe(0);
    expect(peak([])).toBe(0);
  });
});
