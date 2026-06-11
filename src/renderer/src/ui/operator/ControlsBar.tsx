// Pasek kontrolny: start/pauza/wznow/koniec + POMIN / POWTORZ / FORSUJ / PONOW.
// Przyciski odzwierciedlaja legalne akcje maszyny stanow (disabled wg fazy).
import type { ReactElement } from 'react';
import type { MachineState } from '../../core/sessionMachine';
import { sessionController } from '../../state/useSession';

interface Props {
  machine: MachineState;
  canStart: boolean;
  busyStarting: boolean;
  onStart: () => void;
}

export function ControlsBar({ machine, canStart, busyStarting, onStart }: Props): ReactElement {
  const { phase, ctx } = machine;
  const active = phase !== 'KONFIGURACJA' && phase !== 'SOUNDCHECK' && phase !== 'GOTOWOSC' && phase !== 'KONIEC';

  return (
    <div className="controls-bar">
      {(phase === 'KONFIGURACJA' || phase === 'GOTOWOSC') && (
        <button className="primary big" disabled={!canStart || busyStarting} onClick={onStart}>
          {busyStarting ? 'Startuje…' : phase === 'GOTOWOSC' ? '▶ Start sesji' : '▶ Start (najpierw soundcheck)'}
        </button>
      )}
      {active && (
        <>
          <button
            disabled={!(phase === 'SLUCHAM' || phase === 'DOMYKANIE' || phase === 'TLUMACZE' || phase === 'ODTWARZAM')}
            onClick={() => sessionController.dispatch({ type: 'PAUSE' })}
          >
            ⏸ Pauza
          </button>
          <button disabled={phase !== 'PAUZA'} onClick={() => sessionController.dispatch({ type: 'RESUME' })}>
            ▶ Wznow
          </button>
          <button
            disabled={!(phase === 'TLUMACZE' || phase === 'ODTWARZAM' || phase === 'AWARIA_RETRY')}
            onClick={() => sessionController.dispatch({ type: 'SKIP' })}
          >
            ⏭ Pomin segment
          </button>
          <button
            disabled={!(phase === 'SLUCHAM' && !ctx.speaking && ctx.lastFinished !== null)}
            onClick={() => sessionController.dispatch({ type: 'REPEAT' })}
          >
            🔁 Powtorz ostatni
          </button>
          <button
            disabled={!(phase === 'SLUCHAM' && ctx.speaking)}
            onClick={() => sessionController.dispatch({ type: 'FORCE_END_TURN' })}
          >
            ✂ Forsuj koniec tury
          </button>
          <button
            disabled={phase !== 'AWARIA_RETRY'}
            onClick={() => sessionController.dispatch({ type: 'RETRY' })}
          >
            ↻ Ponow teraz
          </button>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="danger" onClick={() => void sessionController.endSession()}>
            ⏹ Koniec sesji
          </button>
        </>
      )}
      {phase === 'KONIEC' && (
        <>
          <span className="hint">Sesja zakonczona — artefakty zapisane.</span>
          <button onClick={() => void window.live.artifactsExport().then((r) => alert(`Eksport: ${r.zipPath}`))}>
            📦 Eksportuj ZIP
          </button>
          <button onClick={() => void window.live.openSessionsFolder()}>📂 Otworz folder sesji</button>
        </>
      )}
    </div>
  );
}
