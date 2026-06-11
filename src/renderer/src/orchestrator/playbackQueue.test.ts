import { describe, expect, it } from 'vitest';
import { int16ToFloat32, PlaybackScheduler } from './playbackQueue';

describe('int16ToFloat32', () => {
  it('skaluje do [-1, 1)', () => {
    const out = int16ToFloat32(new Int16Array([0, 16384, -16384, 32767, -32768]));
    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo(0.5, 4);
    expect(out[2]).toBeCloseTo(-0.5, 4);
    expect(out[3]).toBeCloseTo(0.99997, 4);
    expect(out[4]).toBe(-1);
  });
});

describe('PlaybackScheduler', () => {
  it('pierwszy chunk startuje natychmiast, kolejne back-to-back', () => {
    const s = new PlaybackScheduler();
    expect(s.schedule(10.0, 2.0)).toBe(10.0);
    expect(s.schedule(10.5, 1.0)).toBe(12.0); // doklejony za pierwszym
    expect(s.queuedUntil).toBe(13.0);
  });

  it('po luce (zegar przegonil kolejke) startuje od currentTime — bez nadganiania', () => {
    const s = new PlaybackScheduler();
    s.schedule(0, 1.0); // konczy o 1.0
    expect(s.schedule(5.0, 1.0)).toBe(5.0); // chunk przyszedl pozno
  });

  it('reset zaczyna harmonogram od nowa', () => {
    const s = new PlaybackScheduler();
    s.schedule(0, 10);
    s.reset();
    expect(s.schedule(1, 1)).toBe(1);
  });
});
