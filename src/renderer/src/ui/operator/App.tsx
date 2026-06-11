// Pulpit operatorski — sklada panele + dialogi + akcje sesji (Unit 10).
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { ProfileDto, SettingsDto } from '../../../../shared/ipc';
import { listDevices } from '../../audio/deviceRegistry';
import { restoreSavedDevices } from '../../audio/deviceRestore';
import { median } from '../../orchestrator/latency';
import { sessionController, useSession } from '../../state/useSession';
import { AlertsPanel } from './AlertsPanel';
import { ControlsBar } from './ControlsBar';
import { DevicePanel } from './DevicePanel';
import { ProfilesDialog } from './ProfilesDialog';
import { SegmentFeed } from './SegmentFeed';
import { SettingsDialog } from './SettingsDialog';
import { SoundcheckWizard } from './SoundcheckWizard';
import { SpikePanel } from './SpikePanel';

type DialogId = 'settings' | 'profiles' | 'soundcheck' | 'spike' | null;

export function App(): ReactElement {
  const session = useSession();
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [profiles, setProfiles] = useState<ProfileDto[]>([]);
  const [dialog, setDialog] = useState<DialogId>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [recovered, setRecovered] = useState<string[]>([]);
  const [speakerVisible, setSpeakerVisible] = useState(true);

  const patchSettings = useCallback((patch: Partial<SettingsDto>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    void window.live.saveSettings(patch);
  }, []);

  useEffect(() => {
    void window.live.getSettings().then((s) => {
      setSettings(s);
      // Przywroc zapisane urzadzenia do silnika — bez tego po restarcie dropdowny
      // pokazuja urzadzenia, a tor audio jest martwy (ton testowy/soundcheck/spike).
      void listDevices()
        .then((devices) => restoreSavedDevices(sessionController.engine, devices, s))
        .then((patch) => {
          if (Object.keys(patch).length > 0) patchSettings(patch);
        })
        .catch(() => undefined); // best-effort — urzadzenia zawsze mozna wybrac recznie
    });
    void window.live.listProfiles().then(setProfiles);
    void window.live.recoverSessions().then((r) => setRecovered(r.map((x) => x.sessionId)));
    void window.live.setSpeakerStatus({ mode: 'IDLE' });
  }, [patchSettings]);

  const refreshProfiles = useCallback(async () => {
    setProfiles(await window.live.listProfiles());
  }, []);

  if (!settings) return <div className="app" />;

  const activeProfile = profiles.find((p) => p.id === settings.activeProfileId) ?? null;
  const { phase } = session.machine;
  const inSession = phase !== 'KONFIGURACJA' && phase !== 'SOUNDCHECK' && phase !== 'GOTOWOSC' && phase !== 'KONIEC';
  const medianMs = median(session.latencyTotals);

  const startSession = async (): Promise<void> => {
    setStartError(null);
    if (phase === 'KONFIGURACJA') {
      sessionController.dispatch({ type: 'SOUNDCHECK_START' });
      setDialog('soundcheck');
      return;
    }
    if (!activeProfile) {
      setStartError('Wybierz aktywny profil mowcy (Profile).');
      return;
    }
    try {
      await sessionController.startSession({ voiceId: activeProfile.voiceId, profileName: activeProfile.name });
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="app">
      <div className="topbar">
        <span className="title">Live Interpreter</span>
        <span className={`phase-badge phase-${phase}`}>{phase}</span>
        {session.lastLatencyMs !== null && (
          <span className={`latency-chip ${session.lastLatencyMs > 2000 ? 'over' : ''}`}>
            ostatnia: {(session.lastLatencyMs / 1000).toFixed(2)} s
          </span>
        )}
        {medianMs !== null && (
          <span className="latency-chip">mediana: {(medianMs / 1000).toFixed(2)} s</span>
        )}
        {activeProfile && <span className="hint">🎤 {activeProfile.name} → {settings.targetLang}</span>}
        <span className="spacer" />
        <button onClick={() => setDialog('profiles')} disabled={inSession}>Profile</button>
        <button onClick={() => setDialog('settings')}>Ustawienia</button>
        <button
          onClick={() => {
            sessionController.dispatch({ type: 'SOUNDCHECK_START' });
            setDialog('soundcheck');
          }}
          disabled={inSession}
        >
          Soundcheck
        </button>
        <button onClick={() => setDialog('spike')} disabled={inSession}>Spike</button>
        <button
          onClick={() => {
            void window.live.toggleSpeakerWindow().then(setSpeakerVisible);
          }}
          title="Okno wskaznika dla mowcy — na evencie przeciagnij je na ekran skierowany do mowcy"
        >
          {speakerVisible ? 'Ukryj wskaznik mowcy' : 'Pokaz wskaznik mowcy'}
        </button>
      </div>

      {(startError || recovered.length > 0) && (
        <div style={{ padding: '8px 16px' }}>
          {startError && <div className="alert alert-error">{startError}</div>}
          {recovered.length > 0 && (
            <div className="alert alert-info">
              Odzyskano niedomkniete sesje po crashu: {recovered.join(', ')} (artefakty zalatane).{' '}
              <button onClick={() => void window.live.openSessionsFolder()}>Otworz folder</button>
            </div>
          )}
        </div>
      )}

      <div className="main-grid">
        <div className="panel">
          <DevicePanel settings={settings} onSettingsChange={patchSettings} disabled={inSession} />
        </div>
        <div className="panel">
          <h2>Segmenty</h2>
          <SegmentFeed segments={session.segments} />
        </div>
        <div className="panel">
          <AlertsPanel alerts={session.alerts} />
        </div>
      </div>

      <ControlsBar
        machine={session.machine}
        canStart={phase === 'KONFIGURACJA' || (phase === 'GOTOWOSC' && activeProfile !== null)}
        busyStarting={session.busyStarting}
        onStart={() => void startSession()}
      />

      {dialog === 'settings' && (
        <SettingsDialog settings={settings} onSettingsChange={patchSettings} onClose={() => setDialog(null)} />
      )}
      {dialog === 'profiles' && (
        <ProfilesDialog
          settings={settings}
          onSettingsChange={patchSettings}
          onClose={() => {
            void refreshProfiles();
            setDialog(null);
          }}
        />
      )}
      {dialog === 'soundcheck' && (
        <SoundcheckWizard
          settings={settings}
          profiles={profiles}
          onSettingsChange={patchSettings}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'spike' && (
        <SpikePanel
          settings={settings}
          profiles={profiles}
          onSettingsChange={patchSettings}
          onOpenProfiles={() => setDialog('profiles')}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
