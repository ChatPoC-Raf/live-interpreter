// Maszyna stanow sesji tlumaczenia konsekutywnego — czysty TS, zero zaleznosci.
// Reducer: (stan, zdarzenie) -> { stan, efekty }. Efekty sa deklaratywne —
// interpretuje je SessionController. Nielegalne zdarzenia sa ignorowane.
// Twardy inwariant v1: maksymalnie JEDEN segment in-flight (bez kolejki).
import type { ErrorKind } from './errors';

export type Phase =
  | 'KONFIGURACJA'
  | 'SOUNDCHECK'
  | 'GOTOWOSC'
  | 'SLUCHAM'
  | 'DOMYKANIE'
  | 'TLUMACZE'
  | 'ODTWARZAM'
  | 'PAUZA'
  | 'AWARIA_RETRY'
  | 'AWARIA_TERMINALNA'
  | 'KONIEC';

export interface MachineCtx {
  /** Numer ostatnio rozpoczetego segmentu (1-based). */
  segmentCounter: number;
  /** Segment aktualnie in-flight (TLUMACZE/ODTWARZAM/AWARIA_*) — max jeden. */
  inFlight: number | null;
  /** Czy mowca aktualnie mowi (w SLUCHAM). */
  speaking: boolean;
  retryCount: number;
  lastError: { code: string; message: string } | null;
  /** Ostatni segment odtworzony do konca — do POWTORZ. */
  lastFinished: number | null;
}

export interface MachineState {
  phase: Phase;
  ctx: MachineCtx;
}

export type MachineEvent =
  | { type: 'SOUNDCHECK_START' }
  | { type: 'SOUNDCHECK_PASSED' }
  | { type: 'SOUNDCHECK_BACK' }
  | { type: 'SESSION_START' }
  | { type: 'SPEECH_START' }
  | { type: 'SPEECH_END' }
  | { type: 'SPEECH_RESUMED' }
  | { type: 'SPEECH_MISFIRE' }
  | { type: 'COMMIT' }
  | { type: 'FORCE_END_TURN' }
  | { type: 'FIRST_AUDIO' }
  | { type: 'PLAYBACK_DONE' }
  | { type: 'SEGMENT_FILTERED' }
  | { type: 'SKIP' }
  | { type: 'REPEAT' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'ERROR'; kind: ErrorKind; code: string; message: string }
  | { type: 'RETRY' }
  | { type: 'KEY_REPLACED' }
  | { type: 'DEVICE_LOST' }
  | { type: 'BARGE_IN' }
  | { type: 'END_SESSION' };

export type AbortReason = 'skip' | 'pause' | 'end' | 'error' | 'device';

export type Effect =
  | { type: 'ABORT_SEGMENT'; reason: AbortReason }
  | { type: 'START_TRANSLATION' }
  | { type: 'RETRY_SEGMENT' }
  | { type: 'FORCE_COMMIT' }
  | { type: 'GATE_MIC' }
  | { type: 'OPEN_MIC' }
  | { type: 'PLAY_LAST_AGAIN' }
  | { type: 'SIGNAL_SPEAKER'; mode: 'IDLE' | 'MOW' | 'CZEKAJ_TLUMACZE' | 'CZEKAJ_ODTWARZAM' | 'PAUZA' | 'AWARIA' }
  | { type: 'ALERT'; level: 'info' | 'warn' | 'error'; code: string }
  | { type: 'LOG'; event: string };

export interface ReduceResult {
  state: MachineState;
  effects: Effect[];
}

export const MAX_RETRIES = 2;

export const INITIAL_STATE: MachineState = {
  phase: 'KONFIGURACJA',
  ctx: {
    segmentCounter: 0,
    inFlight: null,
    speaking: false,
    retryCount: 0,
    lastError: null,
    lastFinished: null,
  },
};

const ACTIVE_PHASES: readonly Phase[] = ['SLUCHAM', 'DOMYKANIE', 'TLUMACZE', 'ODTWARZAM'];

function to(
  state: MachineState,
  phase: Phase,
  ctxPatch: Partial<MachineCtx>,
  effects: Effect[],
): ReduceResult {
  return { state: { phase, ctx: { ...state.ctx, ...ctxPatch } }, effects };
}

function stay(state: MachineState, effects: Effect[] = []): ReduceResult {
  return { state, effects };
}

function abortIfInFlight(state: MachineState, reason: AbortReason): Effect[] {
  return state.ctx.inFlight !== null ? [{ type: 'ABORT_SEGMENT', reason }] : [];
}

export function reduce(state: MachineState, event: MachineEvent): ReduceResult {
  const { phase, ctx } = state;
  if (phase === 'KONIEC') return stay(state);

  switch (event.type) {
    case 'SOUNDCHECK_START':
      return phase === 'KONFIGURACJA' || phase === 'GOTOWOSC'
        ? to(state, 'SOUNDCHECK', {}, [{ type: 'LOG', event: 'soundcheck_start' }])
        : stay(state);
    case 'SOUNDCHECK_PASSED':
      return phase === 'SOUNDCHECK'
        ? to(state, 'GOTOWOSC', {}, [{ type: 'LOG', event: 'soundcheck_passed' }])
        : stay(state);
    case 'SOUNDCHECK_BACK':
      return phase === 'SOUNDCHECK' ? to(state, 'KONFIGURACJA', {}, []) : stay(state);

    case 'SESSION_START':
      return phase === 'GOTOWOSC'
        ? to(state, 'SLUCHAM', { speaking: false }, [
            { type: 'OPEN_MIC' },
            { type: 'SIGNAL_SPEAKER', mode: 'MOW' },
            { type: 'LOG', event: 'session_start' },
          ])
        : stay(state);

    case 'SPEECH_START':
      return phase === 'SLUCHAM' && !ctx.speaking
        ? to(state, 'SLUCHAM', { speaking: true, segmentCounter: ctx.segmentCounter + 1 }, [
            { type: 'LOG', event: 'speech_start' },
          ])
        : stay(state);

    case 'SPEECH_END':
      return phase === 'SLUCHAM' && ctx.speaking
        ? to(state, 'DOMYKANIE', {}, [{ type: 'LOG', event: 'speech_end_provisional' }])
        : stay(state);

    case 'SPEECH_RESUMED':
      // Falszywa pauza — okno anulowania DOMYKANIE -> SLUCHAM (sklejanie segmentu).
      return phase === 'DOMYKANIE'
        ? to(state, 'SLUCHAM', { speaking: true }, [{ type: 'LOG', event: 'speech_resumed' }])
        : stay(state);

    case 'SPEECH_MISFIRE':
      // Mowa krotsza niz minSpeech (stukniecie, kaszlniecie) — wracamy do nasluchu
      // bez tlumaczenia; segment dostaje flage FILTERED w kontrolerze.
      return (phase === 'SLUCHAM' && ctx.speaking) || phase === 'DOMYKANIE'
        ? to(state, 'SLUCHAM', { speaking: false }, [{ type: 'LOG', event: 'speech_misfire' }])
        : stay(state);

    case 'COMMIT':
      return phase === 'DOMYKANIE'
        ? to(state, 'TLUMACZE', { inFlight: ctx.segmentCounter, speaking: false, retryCount: 0 }, [
            { type: 'GATE_MIC' },
            { type: 'START_TRANSLATION' },
            { type: 'SIGNAL_SPEAKER', mode: 'CZEKAJ_TLUMACZE' },
            { type: 'LOG', event: 'commit' },
          ])
        : stay(state);

    case 'FORCE_END_TURN':
      return phase === 'SLUCHAM' && ctx.speaking
        ? to(state, 'DOMYKANIE', {}, [{ type: 'FORCE_COMMIT' }, { type: 'LOG', event: 'force_end_turn' }])
        : stay(state);

    case 'FIRST_AUDIO':
      return phase === 'TLUMACZE'
        ? to(state, 'ODTWARZAM', {}, [{ type: 'SIGNAL_SPEAKER', mode: 'CZEKAJ_ODTWARZAM' }])
        : stay(state);

    case 'PLAYBACK_DONE':
      return phase === 'ODTWARZAM'
        ? to(state, 'SLUCHAM', { lastFinished: ctx.inFlight, inFlight: null, retryCount: 0 }, [
            { type: 'OPEN_MIC' },
            { type: 'SIGNAL_SPEAKER', mode: 'MOW' },
            { type: 'LOG', event: 'segment_done' },
          ])
        : stay(state);

    case 'SEGMENT_FILTERED':
      return phase === 'TLUMACZE'
        ? to(state, 'SLUCHAM', { inFlight: null }, [
            { type: 'OPEN_MIC' },
            { type: 'SIGNAL_SPEAKER', mode: 'MOW' },
            { type: 'LOG', event: 'segment_filtered' },
          ])
        : stay(state);

    case 'SKIP':
      return phase === 'TLUMACZE' || phase === 'ODTWARZAM' || phase === 'AWARIA_RETRY'
        ? to(state, 'SLUCHAM', { inFlight: null, retryCount: 0 }, [
            { type: 'ABORT_SEGMENT', reason: 'skip' },
            { type: 'OPEN_MIC' },
            { type: 'SIGNAL_SPEAKER', mode: 'MOW' },
            { type: 'LOG', event: 'segment_skipped' },
          ])
        : stay(state);

    case 'REPEAT':
      return phase === 'SLUCHAM' && !ctx.speaking && ctx.lastFinished !== null
        ? to(state, 'ODTWARZAM', { inFlight: ctx.lastFinished }, [
            { type: 'GATE_MIC' },
            { type: 'PLAY_LAST_AGAIN' },
            { type: 'SIGNAL_SPEAKER', mode: 'CZEKAJ_ODTWARZAM' },
            { type: 'LOG', event: 'segment_repeat' },
          ])
        : stay(state);

    case 'PAUSE':
      return ACTIVE_PHASES.includes(phase)
        ? to(state, 'PAUZA', { inFlight: null, speaking: false }, [
            ...abortIfInFlight(state, 'pause'),
            { type: 'GATE_MIC' },
            { type: 'SIGNAL_SPEAKER', mode: 'PAUZA' },
            { type: 'LOG', event: 'session_pause' },
          ])
        : stay(state);

    case 'RESUME':
      return phase === 'PAUZA'
        ? to(state, 'SLUCHAM', { speaking: false }, [
            { type: 'OPEN_MIC' },
            { type: 'SIGNAL_SPEAKER', mode: 'MOW' },
            { type: 'LOG', event: 'session_resume' },
          ])
        : stay(state);

    case 'ERROR': {
      const inSegment = phase === 'TLUMACZE' || phase === 'ODTWARZAM' || phase === 'AWARIA_RETRY';
      if (!inSegment) {
        // Blad poza segmentem (np. soundcheck) — tylko alert.
        return stay(state, [{ type: 'ALERT', level: 'error', code: event.code }]);
      }
      const lastError = { code: event.code, message: event.message };
      if (event.kind === 'terminal') {
        return to(state, 'AWARIA_TERMINALNA', { lastError }, [
          { type: 'ABORT_SEGMENT', reason: 'error' },
          { type: 'GATE_MIC' },
          { type: 'SIGNAL_SPEAKER', mode: 'AWARIA' },
          { type: 'ALERT', level: 'error', code: event.code },
        ]);
      }
      const retryCount = ctx.retryCount + 1;
      if (retryCount > MAX_RETRIES) {
        return to(state, 'AWARIA_TERMINALNA', { lastError, retryCount }, [
          { type: 'ABORT_SEGMENT', reason: 'error' },
          { type: 'GATE_MIC' },
          { type: 'SIGNAL_SPEAKER', mode: 'AWARIA' },
          { type: 'ALERT', level: 'error', code: 'retry_exhausted' },
        ]);
      }
      return to(state, 'AWARIA_RETRY', { lastError, retryCount }, [
        { type: 'SIGNAL_SPEAKER', mode: 'AWARIA' },
        { type: 'ALERT', level: 'warn', code: event.code },
        { type: 'LOG', event: 'segment_error_transient' },
      ]);
    }

    case 'RETRY':
      return phase === 'AWARIA_RETRY'
        ? to(state, 'TLUMACZE', {}, [{ type: 'RETRY_SEGMENT' }, { type: 'LOG', event: 'segment_retry' }])
        : stay(state);

    case 'KEY_REPLACED':
      return phase === 'AWARIA_TERMINALNA'
        ? to(state, 'PAUZA', { inFlight: null, retryCount: 0, lastError: null }, [
            { type: 'ALERT', level: 'info', code: 'key_replaced' },
            { type: 'SIGNAL_SPEAKER', mode: 'PAUZA' },
            { type: 'LOG', event: 'key_replaced' },
          ])
        : stay(state);

    case 'DEVICE_LOST':
      return ACTIVE_PHASES.includes(phase)
        ? to(state, 'PAUZA', { inFlight: null, speaking: false }, [
            ...abortIfInFlight(state, 'device'),
            { type: 'GATE_MIC' },
            { type: 'ALERT', level: 'error', code: 'device_lost' },
            { type: 'SIGNAL_SPEAKER', mode: 'PAUZA' },
            { type: 'LOG', event: 'device_lost' },
          ])
        : stay(state);

    case 'BARGE_IN':
      return phase === 'TLUMACZE' || phase === 'ODTWARZAM'
        ? stay(state, [
            { type: 'ALERT', level: 'warn', code: 'barge_in' },
            { type: 'LOG', event: 'barge_in' },
          ])
        : stay(state);

    case 'END_SESSION':
      return to(state, 'KONIEC', { inFlight: null, speaking: false }, [
        ...abortIfInFlight(state, 'end'),
        { type: 'GATE_MIC' },
        { type: 'SIGNAL_SPEAKER', mode: 'IDLE' },
        { type: 'LOG', event: 'session_end' },
      ]);
  }
}

/** Inwarianty maszyny — wolane w testach po kazdym przejsciu. */
export function assertInvariants(state: MachineState): void {
  const { phase, ctx } = state;
  const mustHaveInFlight: Phase[] = ['TLUMACZE', 'ODTWARZAM'];
  if (mustHaveInFlight.includes(phase) && ctx.inFlight === null) {
    throw new Error(`Inwariant zlamany: ${phase} bez segmentu in-flight`);
  }
  const mustBeIdle: Phase[] = ['KONFIGURACJA', 'SOUNDCHECK', 'GOTOWOSC', 'PAUZA', 'KONIEC'];
  if (mustBeIdle.includes(phase) && ctx.inFlight !== null) {
    throw new Error(`Inwariant zlamany: ${phase} z segmentem in-flight`);
  }
}
