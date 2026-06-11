import { describe, expect, it } from 'vitest';
import { BargeInDetector, PauseTracker } from './vadLogic';

describe('PauseTracker', () => {
  const tracker = (): PauseTracker => new PauseTracker(0.5, 0.35);

  it('mowa -> cisza emituje provisional_pause raz', () => {
    const t = tracker();
    expect(t.feed(0.9)).toBeNull(); // mowa
    expect(t.feed(0.9)).toBeNull();
    expect(t.feed(0.1)).toBe('provisional_pause');
    expect(t.feed(0.1)).toBeNull(); // dalej cicho — bez powtorki
  });

  it('mowa wraca w oknie -> resumed (falszywa pauza)', () => {
    const t = tracker();
    t.feed(0.9);
    t.feed(0.1);
    expect(t.feed(0.95)).toBe('resumed');
    // kolejna pauza znow emituje provisional
    expect(t.feed(0.05)).toBe('provisional_pause');
  });

  it('cisza bez wczesniejszej mowy nie emituje nic', () => {
    const t = tracker();
    expect(t.feed(0.05)).toBeNull();
    expect(t.feed(0.05)).toBeNull();
  });

  it('strefa posrednia (miedzy progami) nie zmienia stanu', () => {
    const t = tracker();
    t.feed(0.9);
    expect(t.feed(0.42)).toBeNull(); // miedzy 0.35 a 0.5 — histereza
    expect(t.feed(0.1)).toBe('provisional_pause');
  });

  it('reset zaczyna od zera', () => {
    const t = tracker();
    t.feed(0.9);
    t.reset();
    expect(t.feed(0.1)).toBeNull(); // bez mowy przed — brak pauzy
  });
});

describe('BargeInDetector', () => {
  it('alarmuje po utrzymaniu energii przez sustainMs', () => {
    const d = new BargeInDetector(0.07, 250);
    expect(d.feed(0.2, 0)).toBe(false);
    expect(d.feed(0.2, 100)).toBe(false);
    expect(d.feed(0.2, 260)).toBe(true);
  });

  it('pojedynczy trzask (krotki) nie alarmuje', () => {
    const d = new BargeInDetector(0.07, 250);
    expect(d.feed(0.5, 0)).toBe(false);
    expect(d.feed(0.01, 100)).toBe(false); // spadlo — licznik od nowa
    expect(d.feed(0.5, 200)).toBe(false);
    expect(d.feed(0.5, 400)).toBe(false); // dopiero 200 ms od wznowienia
    expect(d.feed(0.5, 460)).toBe(true);
  });

  it('jeden alarm na okres zamkniecia bramy', () => {
    const d = new BargeInDetector(0.07, 100);
    d.feed(0.5, 0);
    expect(d.feed(0.5, 150)).toBe(true);
    expect(d.feed(0.5, 300)).toBe(false); // juz odpalony
    d.reset();
    d.feed(0.5, 400);
    expect(d.feed(0.5, 550)).toBe(true); // nowy okres
  });

  it('cisza nigdy nie alarmuje', () => {
    const d = new BargeInDetector(0.07, 100);
    expect(d.feed(0.01, 0)).toBe(false);
    expect(d.feed(0.02, 500)).toBe(false);
  });
});
