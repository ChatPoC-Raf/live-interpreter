import { describe, expect, it } from 'vitest';
import { isLikelyHfp } from './hfp';

describe('isLikelyHfp', () => {
  it('wykrywa po niskim sampleRate (<=16 kHz)', () => {
    expect(isLikelyHfp({ label: 'Zestaw nagłowny', sampleRate: 16000 })).toBe(true);
    expect(isLikelyHfp({ label: 'Zestaw nagłowny', sampleRate: 8000 })).toBe(true);
  });

  it('wykrywa po etykiecie Hands-Free (Windows BT HFP)', () => {
    expect(isLikelyHfp({ label: 'Headset (Soundcore Hands-Free AG Audio)' })).toBe(true);
    expect(isLikelyHfp({ label: 'Sluchawki HFP' })).toBe(true);
  });

  it('nie flaguje pelnopasmowego USB przy 48 kHz', () => {
    expect(isLikelyHfp({ label: 'Rode Wireless GO RX', sampleRate: 48000 })).toBe(false);
  });

  it('nie flaguje gdy brak sampleRate i etykieta neutralna', () => {
    expect(isLikelyHfp({ label: 'Mikrofon (Realtek HD Audio)' })).toBe(false);
  });
});
