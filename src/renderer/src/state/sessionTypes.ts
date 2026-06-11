// Typy widoku sesji dla UI (snapshot kontrolera).
import type { MachineState } from '../core/sessionMachine';
import type { SegmentView } from '../core/segment';
import type { InputChainInfo } from '../audio/audioEngine';

export interface AlertItem {
  id: number;
  level: 'info' | 'warn' | 'error';
  code: string;
  message: string;
  at: number;
}

export interface SessionSnapshot {
  machine: MachineState;
  segments: SegmentView[];
  alerts: AlertItem[];
  inputLevel: number;
  inputInfo: InputChainInfo | null;
  lastLatencyMs: number | null;
  latencyTotals: number[];
  sessionActive: boolean;
  busyStarting: boolean;
}

export const ALERT_MESSAGES: Record<string, string> = {
  barge_in: 'Mowca mowil podczas odtwarzania — tresc nagrana, ale NIE przetlumaczona (barge-in)',
  device_lost: 'Urzadzenie audio odpiete — sesja wstrzymana. Sprawdz mikrofon i wznow recznie',
  retry_exhausted: 'Wyczerpane proby ponowienia — awaria terminalna, sprawdz klucz/limity',
  key_replaced: 'Klucz podmieniony — wznow sesje gdy bedziesz gotowy',
  quota_exceeded: 'Limit API wyczerpany — podmien klucz w ustawieniach (sesja czeka)',
  hfp_detected: 'Mikrofon w trybie HFP (jakosc telefoniczna) — zalecany mikrofon z donglem USB',
  segment_gap: 'Luka: tresc nagrana w original.wav, ale nie przetlumaczona',
  force_limit: 'Tura przekroczyla 3 minuty — wymuszono domkniecie segmentu',
  voice_improved: 'Klon glosu doszkolony swieza mowa z wystapienia — kolejne segmenty brzmia lepiej',
  voice_improve_failed: 'Doszkolenie klonu glosu nieudane — tlumaczenie dziala dalej na dotychczasowym glosie',
};

export function alertMessage(code: string): string {
  return ALERT_MESSAGES[code] ?? `Problem: ${code}`;
}
