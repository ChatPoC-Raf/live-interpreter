// Heurystyka wykrywania degradacji Bluetooth HFP (8-16 kHz, jakosc telefoniczna).
// Mikrofon BT Classic przy przechwytywaniu ZAWSZE spada do HFP — ostrzegamy
// i rekomendujemy mikrofon z donglem USB (pelne pasmo).

export interface HfpCheckInput {
  label: string;
  /** sampleRate z MediaTrackSettings (moze byc undefined). */
  sampleRate?: number;
}

export function isLikelyHfp(input: HfpCheckInput): boolean {
  if (input.sampleRate !== undefined && input.sampleRate <= 16000) return true;
  return /hands-?free|\bHFP\b|\bAG Audio\b/i.test(input.label);
}

export const HFP_WARNING =
  'Mikrofon wyglada na polaczenie Bluetooth w trybie HFP (jakosc telefoniczna 8-16 kHz). ' +
  'To pogorszy transkrypcje i klon glosu. Zalecany mikrofon bezprzewodowy z donglem USB ' +
  '(np. Rode Wireless GO, DJI Mic).';
