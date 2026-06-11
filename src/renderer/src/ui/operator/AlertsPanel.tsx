// Panel alertow: awarie, barge-in, HFP, odpiete urzadzenia. Nigdy cicho.
import type { ReactElement } from 'react';
import type { AlertItem } from '../../state/sessionTypes';

export function AlertsPanel({ alerts }: { alerts: AlertItem[] }): ReactElement {
  return (
    <div>
      <h2>Alerty</h2>
      {alerts.length === 0 && <div className="hint">Cisza w eterze — zadnych problemow.</div>}
      <div className="alerts">
        {alerts.map((a) => (
          <div key={a.id} className={`alert alert-${a.level}`}>
            <b>{new Date(a.at).toLocaleTimeString()}</b> — {a.message}
          </div>
        ))}
      </div>
    </div>
  );
}
