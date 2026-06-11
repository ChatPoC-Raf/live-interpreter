// Pulpit operatorski — szkielet (Unit 1). Pelny pulpit powstaje w Unit 10.
import type { ReactElement } from 'react';

export function App(): ReactElement {
  return (
    <div className="app">
      <div className="topbar">
        <span className="title">Live Interpreter</span>
        <span className="phase-badge">SCAFFOLD</span>
      </div>
      <div className="main-grid">
        <div className="panel">Audio</div>
        <div className="panel">Segmenty</div>
        <div className="panel">Alerty</div>
      </div>
    </div>
  );
}
