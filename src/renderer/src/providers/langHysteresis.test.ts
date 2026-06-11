import { describe, expect, it } from 'vitest';
import { LanguageHysteresis } from './langHysteresis';

describe('LanguageHysteresis', () => {
  it('pierwszy segment idzie z auto-detekcja (null)', () => {
    const h = new LanguageHysteresis();
    expect(h.sourceLang).toBeNull();
  });

  it('zmiana jezyka MT dopiero po pelnym segmencie w nowym jezyku', () => {
    const h = new LanguageHysteresis();
    h.confirmSegment('pl');
    expect(h.sourceLang).toBe('pl');
    // partials w 'en' NIE wolaja confirmSegment — jezyk zostaje 'pl'
    h.confirmSegment('en'); // dopiero pelny segment po commit przelacza
    expect(h.sourceLang).toBe('en');
  });

  it('null z detekcji nie kasuje ostatniego jezyka', () => {
    const h = new LanguageHysteresis();
    h.confirmSegment('pl');
    h.confirmSegment(null);
    expect(h.sourceLang).toBe('pl');
  });

  it('reset wraca do auto', () => {
    const h = new LanguageHysteresis();
    h.confirmSegment('pl');
    h.reset();
    expect(h.sourceLang).toBeNull();
  });
});
