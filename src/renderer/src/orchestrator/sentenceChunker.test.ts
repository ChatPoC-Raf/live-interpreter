import { describe, expect, it } from 'vitest';
import { SentenceChunker } from './sentenceChunker';

describe('SentenceChunker', () => {
  it('emituje zdanie po kropce ze spacja, koncowke domyka flushRemainder', () => {
    const c = new SentenceChunker();
    expect(c.push('Dzien dobry. Jak ')).toEqual(['Dzien dobry.']);
    expect(c.push('sie masz? Swietnie.')).toEqual(['Jak sie masz?']);
    expect(c.flushRemainder()).toBe('Swietnie.');
  });

  it('zbiera tokeny az do granicy zdania', () => {
    const c = new SentenceChunker();
    expect(c.push('To ')).toEqual([]);
    expect(c.push('jest ')).toEqual([]);
    expect(c.push('test. ')).toEqual(['To jest test.']);
  });

  it('flushRemainder oddaje niedokonczone zdanie', () => {
    const c = new SentenceChunker();
    c.push('Koniec bez kropki');
    expect(c.flushRemainder()).toBe('Koniec bez kropki');
    expect(c.flushRemainder()).toBeNull();
  });

  it('wielokropek i cudzyslow po kropce nalezy do zdania', () => {
    const c = new SentenceChunker();
    expect(c.push('Hmm… No wlasnie. ')).toEqual(['Hmm…', 'No wlasnie.']);
  });

  it('dlugi tekst bez interpunkcji ciety na maxLen przy spacji', () => {
    const c = new SentenceChunker(40);
    const out = c.push('slowo '.repeat(20)); // 120 znakow bez kropki
    expect(out.length).toBeGreaterThanOrEqual(2);
    for (const s of out) expect(s.length).toBeLessThanOrEqual(40);
  });

  it('kropka w skrocie na koncu chunka nie gubi tekstu (emituje przy spacji)', () => {
    const c = new SentenceChunker();
    expect(c.push('Mam 3.')).toEqual([]); // brak spacji — moze byc "3.5"
    expect(c.push('5 procent. Tak.')).toEqual(['Mam 3.5 procent.']);
    expect(c.flushRemainder()).toBe('Tak.');
  });
});
