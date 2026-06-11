// Model segmentu wypowiedzi — jeden ciagly fragment mowy zakonczony pauza.

export type SegmentFlag =
  | 'FILTERED' // odfiltrowany przed MT (za krotki / pusty / juz w jezyku docelowym)
  | 'SKIPPED' // pominiety recznie przez operatora
  | 'SKIPPED_PARTIAL' // przerwany w trakcie (pauza/stop) — czesc mogla byc odtworzona
  | 'BARGE_IN' // mowca mowil podczas zamknietej bramy (tresc w original.wav)
  | 'EMPTY' // STT zwrocil pusty tekst
  | 'GAP'; // luka — tresc nagrana, ale nie przetlumaczona (awaria)

export type SegmentStatus =
  | 'recording'
  | 'committing'
  | 'translating'
  | 'playing'
  | 'done'
  | 'failed';

export interface SegmentView {
  no: number;
  status: SegmentStatus;
  partialText: string;
  originalText: string;
  translatedText: string;
  sourceLang: string | null;
  flags: SegmentFlag[];
  /** Latencja pauza -> pierwszy dzwiek (ms), jesli zmierzona. */
  latencyMs: number | null;
  startedAt: number;
}

export function addFlag(flags: SegmentFlag[], flag: SegmentFlag): SegmentFlag[] {
  return flags.includes(flag) ? flags : [...flags, flag];
}

export function newSegment(no: number, now: number): SegmentView {
  return {
    no,
    status: 'recording',
    partialText: '',
    originalText: '',
    translatedText: '',
    sourceLang: null,
    flags: [],
    latencyMs: null,
    startedAt: now,
  };
}
