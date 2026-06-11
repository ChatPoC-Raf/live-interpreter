// Okno wskaznika mowcy — duzy, czytelny stan + brief "jak to dziala".
// Stany przychodza relayem IPC z pulpitu operatora (main przekazuje speaker:status).
import { useEffect, useState, type ReactElement } from 'react';
import type { SpeakerMode, SpeakerStatusDto } from '../../../../shared/ipc';

interface ModeView {
  label: string;
  hint: string;
  className: string;
}

const MODES: Record<SpeakerMode, ModeView> = {
  IDLE: { label: 'SESJA NIEAKTYWNA', hint: 'Poczekaj na operatora', className: 'speaker-idle' },
  MOW: { label: 'MOW', hint: 'Mikrofon otwarty — mow swobodnie, zrob pauze gdy skonczysz mysl', className: 'speaker-mow' },
  CZEKAJ_TLUMACZE: { label: 'CZEKAJ', hint: 'Tlumacze Twoja wypowiedz...', className: 'speaker-czekaj' },
  CZEKAJ_ODTWARZAM: { label: 'CZEKAJ', hint: 'Publicznosc slucha tlumaczenia', className: 'speaker-odtwarzam' },
  PAUZA: { label: 'PAUZA', hint: 'Sesja wstrzymana przez operatora', className: 'speaker-pauza' },
  AWARIA: { label: 'CHWILA PRZERWY', hint: 'Problem techniczny — operator juz dziala', className: 'speaker-awaria' },
};

export function SpeakerApp(): ReactElement {
  const [status, setStatus] = useState<SpeakerStatusDto>({ mode: 'IDLE' });
  const [showBrief, setShowBrief] = useState(false);

  useEffect(() => window.live.onSpeakerStatus(setStatus), []);

  const view = MODES[status.mode];
  return (
    <div className={`speaker-root ${view.className}`}>
      <div className="speaker-label">{view.label}</div>
      <div className="speaker-hint">{status.detail ?? view.hint}</div>
      <button className="speaker-brief-btn" onClick={() => setShowBrief((v) => !v)}>
        {showBrief ? 'Ukryj instrukcje' : 'Jak to dziala?'}
      </button>
      {showBrief && (
        <div className="speaker-brief">
          <p>1. Gdy widzisz <b>MOW</b> — mow normalnym tempem do mikrofonu.</p>
          <p>2. Gdy skonczysz mysl (1-2 zdania) — zrob wyrazna pauze.</p>
          <p>3. Gdy widzisz <b>CZEKAJ</b> — publicznosc slucha tlumaczenia. Nie mow.</p>
          <p>4. Gdy znow pojawi sie <b>MOW</b> — kontynuuj.</p>
        </div>
      )}
    </div>
  );
}
