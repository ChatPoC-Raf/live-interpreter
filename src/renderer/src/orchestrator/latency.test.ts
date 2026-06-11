import { describe, expect, it } from 'vitest';
import { LatencyMeter, median, p95 } from './latency';

describe('LatencyMeter', () => {
  it('mierzy total pauza -> playback', () => {
    const m = new LatencyMeter();
    m.mark('pauseDetected', 1000);
    m.mark('sttFinal', 1200);
    m.mark('mtFirstToken', 1500);
    m.mark('ttsFirstAudio', 1650);
    m.mark('playbackStart', 1700);
    expect(m.totalMs()).toBe(700);
    expect(m.breakdown()).toEqual({ stt: 200, mt: 300, tts: 150, playback: 50, total: 700 });
  });

  it('brakujace etapy -> null (bez NaN)', () => {
    const m = new LatencyMeter();
    m.mark('pauseDetected', 1000);
    expect(m.totalMs()).toBeNull();
    expect(m.breakdown().mt).toBeNull();
  });

  it('mark jest idempotentny — liczy sie PIERWSZY (np. pierwszy chunk audio)', () => {
    const m = new LatencyMeter();
    m.mark('ttsFirstAudio', 100);
    m.mark('ttsFirstAudio', 999);
    m.mark('mtFirstToken', 50);
    expect(m.spanMs('mtFirstToken', 'ttsFirstAudio')).toBe(50);
  });
});

describe('statystyki', () => {
  it('median dla nieparzystych i parzystych', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it('p95 z proby 10 elementow = element 10 (ceil(9.5))', () => {
    expect(p95([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000])).toBe(1000);
    expect(p95([100, 200])).toBe(200);
  });

  it('puste -> null', () => {
    expect(median([])).toBeNull();
    expect(p95([])).toBeNull();
  });
});
