// Pelna tabela przejsc maszyny stanow sesji. Kazde przejscie weryfikuje
// inwarianty (max 1 segment in-flight) po kazdym kroku.
import { describe, expect, it } from 'vitest';
import type { MachineEvent, MachineState, Effect } from './sessionMachine';
import { assertInvariants, INITIAL_STATE, MAX_RETRIES, reduce } from './sessionMachine';

function run(events: MachineEvent[], from: MachineState = INITIAL_STATE): {
  state: MachineState;
  effects: Effect[];
} {
  let state = from;
  let lastEffects: Effect[] = [];
  for (const ev of events) {
    const r = reduce(state, ev);
    state = r.state;
    lastEffects = r.effects;
    assertInvariants(state);
  }
  return { state, effects: lastEffects };
}

const TO_LISTENING: MachineEvent[] = [
  { type: 'SOUNDCHECK_START' },
  { type: 'SOUNDCHECK_PASSED' },
  { type: 'SESSION_START' },
];

const TO_TRANSLATING: MachineEvent[] = [
  ...TO_LISTENING,
  { type: 'SPEECH_START' },
  { type: 'SPEECH_END' },
  { type: 'COMMIT' },
];

const TO_PLAYING: MachineEvent[] = [...TO_TRANSLATING, { type: 'FIRST_AUDIO' }];

const TRANSIENT: MachineEvent = {
  type: 'ERROR',
  kind: 'transient',
  code: 'http_500',
  message: 'boom',
};
const TERMINAL: MachineEvent = {
  type: 'ERROR',
  kind: 'terminal',
  code: 'quota_exceeded',
  message: 'quota',
};

describe('sciezka szczesliwa', () => {
  it('KONFIGURACJA -> SOUNDCHECK -> GOTOWOSC -> SLUCHAM', () => {
    const { state, effects } = run(TO_LISTENING);
    expect(state.phase).toBe('SLUCHAM');
    expect(effects).toContainEqual({ type: 'OPEN_MIC' });
    expect(effects).toContainEqual({ type: 'SIGNAL_SPEAKER', mode: 'MOW' });
  });

  it('pelny segment: mowa -> pauza -> commit -> audio -> done -> znow SLUCHAM', () => {
    const { state } = run([...TO_PLAYING, { type: 'PLAYBACK_DONE' }]);
    expect(state.phase).toBe('SLUCHAM');
    expect(state.ctx.inFlight).toBeNull();
    expect(state.ctx.lastFinished).toBe(1);
    expect(state.ctx.segmentCounter).toBe(1);
  });

  it('COMMIT gate-uje mikrofon i startuje tlumaczenie (1 segment in-flight)', () => {
    const { state, effects } = run(TO_TRANSLATING);
    expect(state.phase).toBe('TLUMACZE');
    expect(state.ctx.inFlight).toBe(1);
    expect(effects).toContainEqual({ type: 'GATE_MIC' });
    expect(effects).toContainEqual({ type: 'START_TRANSLATION' });
  });

  it('kolejne segmenty inkrementuja licznik', () => {
    const { state } = run([
      ...TO_PLAYING,
      { type: 'PLAYBACK_DONE' },
      { type: 'SPEECH_START' },
      { type: 'SPEECH_END' },
      { type: 'COMMIT' },
    ]);
    expect(state.ctx.segmentCounter).toBe(2);
    expect(state.ctx.inFlight).toBe(2);
  });
});

describe('okno anulowania DOMYKANIE -> SLUCHAM (falszywa pauza)', () => {
  it('SPEECH_RESUMED w DOMYKANIE wraca do SLUCHAM bez nowego segmentu', () => {
    const { state } = run([
      ...TO_LISTENING,
      { type: 'SPEECH_START' },
      { type: 'SPEECH_END' },
      { type: 'SPEECH_RESUMED' },
    ]);
    expect(state.phase).toBe('SLUCHAM');
    expect(state.ctx.speaking).toBe(true);
    expect(state.ctx.segmentCounter).toBe(1); // ten sam segment — sklejony
  });

  it('SPEECH_RESUMED po COMMIT jest ignorowane (okno zamkniete)', () => {
    const { state } = run([...TO_TRANSLATING, { type: 'SPEECH_RESUMED' }]);
    expect(state.phase).toBe('TLUMACZE');
  });
});

describe('SPEECH_MISFIRE (mowa za krotka)', () => {
  it('w DOMYKANIE wraca do SLUCHAM bez tlumaczenia', () => {
    const { state } = run([
      ...TO_LISTENING,
      { type: 'SPEECH_START' },
      { type: 'SPEECH_END' },
      { type: 'SPEECH_MISFIRE' },
    ]);
    expect(state.phase).toBe('SLUCHAM');
    expect(state.ctx.speaking).toBe(false);
    expect(state.ctx.inFlight).toBeNull();
  });

  it('w SLUCHAM podczas mowy konczy "mowe" bez segmentu', () => {
    const { state } = run([...TO_LISTENING, { type: 'SPEECH_START' }, { type: 'SPEECH_MISFIRE' }]);
    expect(state.phase).toBe('SLUCHAM');
    expect(state.ctx.speaking).toBe(false);
  });

  it('ignorowany w TLUMACZE (segment juz zacommitowany)', () => {
    const { state } = run([...TO_TRANSLATING, { type: 'SPEECH_MISFIRE' }]);
    expect(state.phase).toBe('TLUMACZE');
  });
});

describe('FORCE_END_TURN', () => {
  it('forsuje DOMYKANIE z efektem FORCE_COMMIT gdy mowca mowi', () => {
    const { state, effects } = run([...TO_LISTENING, { type: 'SPEECH_START' }, { type: 'FORCE_END_TURN' }]);
    expect(state.phase).toBe('DOMYKANIE');
    expect(effects).toContainEqual({ type: 'FORCE_COMMIT' });
  });

  it('ignorowane gdy mowca nie mowi', () => {
    const { state } = run([...TO_LISTENING, { type: 'FORCE_END_TURN' }]);
    expect(state.phase).toBe('SLUCHAM');
  });
});

describe('POMIN (SKIP)', () => {
  it.each(['TLUMACZE', 'ODTWARZAM', 'AWARIA_RETRY'] as const)('dziala w %s', (phase) => {
    const path: Record<string, MachineEvent[]> = {
      TLUMACZE: TO_TRANSLATING,
      ODTWARZAM: TO_PLAYING,
      AWARIA_RETRY: [...TO_TRANSLATING, TRANSIENT],
    };
    const { state, effects } = run([...path[phase], { type: 'SKIP' }]);
    expect(state.phase).toBe('SLUCHAM');
    expect(state.ctx.inFlight).toBeNull();
    expect(effects).toContainEqual({ type: 'ABORT_SEGMENT', reason: 'skip' });
  });

  it.each(['SLUCHAM', 'PAUZA', 'KONIEC'] as const)('ignorowany w %s', (phase) => {
    const path: Record<string, MachineEvent[]> = {
      SLUCHAM: TO_LISTENING,
      PAUZA: [...TO_LISTENING, { type: 'PAUSE' }],
      KONIEC: [...TO_LISTENING, { type: 'END_SESSION' }],
    };
    const { state } = run([...path[phase], { type: 'SKIP' }]);
    expect(state.phase).toBe(phase);
  });
});

describe('POWTORZ (REPEAT)', () => {
  it('odtwarza ostatni zakonczony segment z zamknieta brama', () => {
    const { state, effects } = run([...TO_PLAYING, { type: 'PLAYBACK_DONE' }, { type: 'REPEAT' }]);
    expect(state.phase).toBe('ODTWARZAM');
    expect(state.ctx.inFlight).toBe(1);
    expect(effects).toContainEqual({ type: 'PLAY_LAST_AGAIN' });
    expect(effects).toContainEqual({ type: 'GATE_MIC' });
  });

  it('ignorowany bez zakonczonego segmentu', () => {
    const { state } = run([...TO_LISTENING, { type: 'REPEAT' }]);
    expect(state.phase).toBe('SLUCHAM');
  });

  it('ignorowany gdy mowca mowi', () => {
    const { state } = run([
      ...TO_PLAYING,
      { type: 'PLAYBACK_DONE' },
      { type: 'SPEECH_START' },
      { type: 'REPEAT' },
    ]);
    expect(state.phase).toBe('SLUCHAM');
    expect(state.ctx.inFlight).toBeNull();
  });
});

describe('PAUZA', () => {
  it('pauza w SLUCHAM gate-uje mikrofon', () => {
    const { state, effects } = run([...TO_LISTENING, { type: 'PAUSE' }]);
    expect(state.phase).toBe('PAUZA');
    expect(effects).toContainEqual({ type: 'GATE_MIC' });
    expect(effects.filter((e) => e.type === 'ABORT_SEGMENT')).toHaveLength(0);
  });

  it.each(['TLUMACZE', 'ODTWARZAM'] as const)('pauza w %s abortuje segment in-flight', (phase) => {
    const path = phase === 'TLUMACZE' ? TO_TRANSLATING : TO_PLAYING;
    const { state, effects } = run([...path, { type: 'PAUSE' }]);
    expect(state.phase).toBe('PAUZA');
    expect(state.ctx.inFlight).toBeNull();
    expect(effects).toContainEqual({ type: 'ABORT_SEGMENT', reason: 'pause' });
  });

  it('RESUME wraca do SLUCHAM (tylko recznie)', () => {
    const { state, effects } = run([...TO_LISTENING, { type: 'PAUSE' }, { type: 'RESUME' }]);
    expect(state.phase).toBe('SLUCHAM');
    expect(effects).toContainEqual({ type: 'OPEN_MIC' });
  });
});

describe('bledy: transient -> retry -> terminal', () => {
  it('blad przejsciowy -> AWARIA_RETRY z licznikiem', () => {
    const { state, effects } = run([...TO_TRANSLATING, TRANSIENT]);
    expect(state.phase).toBe('AWARIA_RETRY');
    expect(state.ctx.retryCount).toBe(1);
    expect(state.ctx.inFlight).toBe(1); // segment czeka na ponowienie
    expect(effects).toContainEqual({ type: 'SIGNAL_SPEAKER', mode: 'AWARIA' });
  });

  it('RETRY wraca do TLUMACZE z efektem RETRY_SEGMENT', () => {
    const { state, effects } = run([...TO_TRANSLATING, TRANSIENT, { type: 'RETRY' }]);
    expect(state.phase).toBe('TLUMACZE');
    expect(effects).toContainEqual({ type: 'RETRY_SEGMENT' });
  });

  it(`po ${MAX_RETRIES + 1} bledach przejsciowych -> AWARIA_TERMINALNA`, () => {
    const events: MachineEvent[] = [...TO_TRANSLATING];
    for (let i = 0; i < MAX_RETRIES; i++) {
      events.push(TRANSIENT, { type: 'RETRY' });
    }
    events.push(TRANSIENT);
    const { state, effects } = run(events);
    expect(state.phase).toBe('AWARIA_TERMINALNA');
    expect(effects).toContainEqual({ type: 'ALERT', level: 'error', code: 'retry_exhausted' });
  });

  it('blad terminalny od razu -> AWARIA_TERMINALNA (bez retry)', () => {
    const { state, effects } = run([...TO_TRANSLATING, TERMINAL]);
    expect(state.phase).toBe('AWARIA_TERMINALNA');
    expect(effects).toContainEqual({ type: 'ABORT_SEGMENT', reason: 'error' });
  });

  it('KEY_REPLACED w AWARIA_TERMINALNA -> PAUZA (wznowienie reczne)', () => {
    const { state } = run([...TO_TRANSLATING, TERMINAL, { type: 'KEY_REPLACED' }, { type: 'RESUME' }]);
    expect(state.phase).toBe('SLUCHAM');
    expect(state.ctx.lastError).toBeNull();
  });

  it('udany retry konczy segment normalnie i zeruje licznik', () => {
    const { state } = run([
      ...TO_TRANSLATING,
      TRANSIENT,
      { type: 'RETRY' },
      { type: 'FIRST_AUDIO' },
      { type: 'PLAYBACK_DONE' },
    ]);
    expect(state.phase).toBe('SLUCHAM');
    expect(state.ctx.retryCount).toBe(0);
    expect(state.ctx.lastFinished).toBe(1);
  });
});

describe('odpiecie urzadzenia', () => {
  it.each(['SLUCHAM', 'TLUMACZE', 'ODTWARZAM'] as const)('DEVICE_LOST w %s -> PAUZA', (phase) => {
    const path: Record<string, MachineEvent[]> = {
      SLUCHAM: TO_LISTENING,
      TLUMACZE: TO_TRANSLATING,
      ODTWARZAM: TO_PLAYING,
    };
    const { state, effects } = run([...path[phase], { type: 'DEVICE_LOST' }]);
    expect(state.phase).toBe('PAUZA');
    expect(effects).toContainEqual({ type: 'ALERT', level: 'error', code: 'device_lost' });
  });
});

describe('barge-in', () => {
  it('sygnalizowany w ODTWARZAM, bez zmiany fazy (nigdy cichy)', () => {
    const { state, effects } = run([...TO_PLAYING, { type: 'BARGE_IN' }]);
    expect(state.phase).toBe('ODTWARZAM');
    expect(effects).toContainEqual({ type: 'ALERT', level: 'warn', code: 'barge_in' });
    expect(effects).toContainEqual({ type: 'LOG', event: 'barge_in' });
  });

  it('ignorowany w SLUCHAM (mikrofon otwarty — to normalna mowa)', () => {
    const { effects } = run([...TO_LISTENING, { type: 'BARGE_IN' }]);
    expect(effects).toHaveLength(0);
  });
});

describe('KONIEC sesji', () => {
  it('END_SESSION z segmentem in-flight abortuje go', () => {
    const { state, effects } = run([...TO_PLAYING, { type: 'END_SESSION' }]);
    expect(state.phase).toBe('KONIEC');
    expect(state.ctx.inFlight).toBeNull();
    expect(effects).toContainEqual({ type: 'ABORT_SEGMENT', reason: 'end' });
    expect(effects).toContainEqual({ type: 'SIGNAL_SPEAKER', mode: 'IDLE' });
  });

  it('KONIEC jest terminalny — wszystkie zdarzenia ignorowane', () => {
    const { state } = run([
      ...TO_LISTENING,
      { type: 'END_SESSION' },
      { type: 'SESSION_START' },
      { type: 'SPEECH_START' },
      { type: 'PAUSE' },
    ]);
    expect(state.phase).toBe('KONIEC');
  });
});

describe('zdarzenia nielegalne sa ignorowane (stan bez zmian)', () => {
  it('COMMIT bez DOMYKANIE', () => {
    const { state } = run([...TO_LISTENING, { type: 'COMMIT' }]);
    expect(state.phase).toBe('SLUCHAM');
  });

  it('FIRST_AUDIO poza TLUMACZE', () => {
    const { state } = run([...TO_LISTENING, { type: 'FIRST_AUDIO' }]);
    expect(state.phase).toBe('SLUCHAM');
  });

  it('PLAYBACK_DONE poza ODTWARZAM', () => {
    const { state } = run([...TO_TRANSLATING, { type: 'PLAYBACK_DONE' }]);
    expect(state.phase).toBe('TLUMACZE');
  });

  it('SPEECH_START w TLUMACZE nie tworzy drugiego segmentu in-flight', () => {
    const { state } = run([...TO_TRANSLATING, { type: 'SPEECH_START' }]);
    expect(state.ctx.segmentCounter).toBe(1);
    expect(state.ctx.inFlight).toBe(1);
  });

  it('RESUME poza PAUZA', () => {
    const { state } = run([...TO_LISTENING, { type: 'RESUME' }]);
    expect(state.phase).toBe('SLUCHAM');
  });

  it('KEY_REPLACED poza AWARIA_TERMINALNA', () => {
    const { state } = run([...TO_LISTENING, { type: 'KEY_REPLACED' }]);
    expect(state.phase).toBe('SLUCHAM');
  });
});
