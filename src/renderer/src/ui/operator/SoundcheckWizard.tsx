// Soundcheck wizard — 6 krokow przed sesja. Bez zaliczonego E2E nie wypuszcza
// do GOTOWOSC (gate), chyba ze operator swiadomie uzyje "Pomin (tryb dev)".
import { useState, type ReactElement } from 'react';
import type { ProfileDto, SettingsDto } from '../../../../shared/ipc';
import { HFP_WARNING } from '../../audio/hfp';
import {
  measureCrosstalk,
  measureNoiseFloor,
  proposeBargeInThreshold,
  runE2ECheck,
  type E2ECheckResult,
} from '../../orchestrator/soundcheck';
import { sessionController, useSession } from '../../state/useSession';

interface Props {
  settings: SettingsDto;
  profiles: ProfileDto[];
  onSettingsChange: (patch: Partial<SettingsDto>) => void;
  onClose: () => void;
}

const STEPS = ['Poziomy', 'HFP', 'Test PA', 'Przesluch', 'E2E', 'Pre-flight'];

export function SoundcheckWizard({ settings, profiles, onSettingsChange, onClose }: Props): ReactElement {
  const session = useSession();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [noise, setNoise] = useState<number | null>(null);
  const [crosstalk, setCrosstalk] = useState<number | null>(null);
  const [paConfirmed, setPaConfirmed] = useState(false);
  const [e2e, setE2e] = useState<E2ECheckResult | null>(null);
  const [preflight, setPreflight] = useState<{ keys: boolean; profile: boolean } | null>(null);

  const activeProfile = profiles.find((p) => p.id === settings.activeProfileId) ?? null;
  const inputReady = sessionController.engine.getInputStream() !== null;
  const outputReady = sessionController.engine.getOutputContext() !== null;

  const measureNoise = async (): Promise<void> => {
    setBusy(true);
    try {
      setNoise(await measureNoiseFloor(sessionController.engine));
    } finally {
      setBusy(false);
    }
  };

  const measureXtalk = async (): Promise<void> => {
    setBusy(true);
    try {
      const x = await measureCrosstalk(sessionController.engine);
      setCrosstalk(x);
      const threshold = proposeBargeInThreshold(noise ?? 0, x);
      onSettingsChange({ bargeInThreshold: Number(threshold.toFixed(4)) });
    } finally {
      setBusy(false);
    }
  };

  const runE2e = async (): Promise<void> => {
    if (!activeProfile) return;
    setBusy(true);
    try {
      setE2e(
        await runE2ECheck(sessionController.engine, {
          voiceId: activeProfile.voiceId,
          targetLang: settings.targetLang,
          llmProvider: settings.llmProvider,
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const runPreflight = async (): Promise<void> => {
    const presence = await window.live.getSecretsPresence();
    setPreflight({ keys: presence.hasElevenKey && presence.hasLlmKey, profile: activeProfile !== null });
  };

  const finish = (skipped: boolean): void => {
    onSettingsChange({ soundcheckPassed: !skipped });
    sessionController.dispatch({ type: 'SOUNDCHECK_PASSED' });
    onClose();
  };

  const stepOk: boolean[] = [
    inputReady && outputReady && noise !== null,
    true, // HFP to ostrzezenie, nie blokada
    paConfirmed,
    crosstalk !== null,
    e2e?.ok === true,
    preflight?.keys === true && preflight?.profile === true,
  ];

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h2>Soundcheck</h2>
        <div className="wizard-steps">
          {STEPS.map((s, i) => (
            <span key={s} className={`wizard-step-dot ${i === step ? 'active' : ''} ${stepOk[i] && i < step ? 'done' : ''}`}>
              {i + 1}. {s}
            </span>
          ))}
        </div>

        {step === 0 && (
          <div>
            <p>Wybierz urzadzenia w panelu Audio (z lewej), poproś o ciszę na sali i zmierz szum tla.</p>
            <div className="kv"><span className="k">Mikrofon</span><span>{inputReady ? 'dziala ✓' : 'NIE uruchomiony'}</span></div>
            <div className="kv"><span className="k">Wyjscie PA</span><span>{outputReady ? 'dziala ✓' : 'NIE uruchomione'}</span></div>
            <div className="kv">
              <span className="k">Szum sali (RMS)</span>
              <span className="mono">{noise !== null ? noise.toFixed(4) : '—'}</span>
            </div>
            <button onClick={() => void measureNoise()} disabled={busy || !inputReady}>
              {busy ? 'Mierze (3 s ciszy)…' : '📏 Zmierz szum sali'}
            </button>
          </div>
        )}

        {step === 1 && (
          <div>
            {session.inputInfo?.likelyHfp ? (
              <p className="warn-text">⚠ {HFP_WARNING}</p>
            ) : (
              <p className="ok-text">Mikrofon wyglada na pelnopasmowy ({session.inputInfo?.sampleRate ?? '?'} Hz). ✓</p>
            )}
            <p className="hint">
              {session.inputInfo?.label} — EC/NS/AGC:{' '}
              {session.inputInfo?.echoCancellation ? 'WLACZONE (problem!)' : 'wylaczone ✓'}
            </p>
          </div>
        )}

        {step === 2 && (
          <div>
            <p>Puszcz ton testowy i potwierdz, ze slychac go z glosnika PA (nie z laptopa).</p>
            <button onClick={() => void sessionController.engine.playTestTone()} disabled={!outputReady}>
              🔊 Ton testowy
            </button>
            <label style={{ marginTop: 10 }}>
              <input type="checkbox" checked={paConfirmed} onChange={(e) => setPaConfirmed(e.target.checked)} style={{ width: 'auto', marginRight: 8 }} />
              Slychac z PA ✓
            </label>
          </div>
        )}

        {step === 3 && (
          <div>
            <p>Pomiar przesluchu PA → mikrofon (kalibruje prog barge-in, zeby playback nie alarmowal sam siebie).</p>
            <button onClick={() => void measureXtalk()} disabled={busy || noise === null}>
              {busy ? 'Mierze…' : '📏 Zagraj ton i zmierz przesluch'}
            </button>
            {crosstalk !== null && (
              <div style={{ marginTop: 8 }}>
                <div className="kv"><span className="k">Przesluch (peak RMS)</span><span className="mono">{crosstalk.toFixed(4)}</span></div>
                <div className="kv"><span className="k">Prog barge-in</span><span className="mono ok-text">{settings.bargeInThreshold}</span></div>
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div>
            <p>Segment testowy E2E: tlumaczenie + synteza klonem ({activeProfile?.name ?? 'BRAK PROFILU'}) przez PA.</p>
            <button onClick={() => void runE2e()} disabled={busy || !activeProfile}>
              {busy ? 'Testuje…' : '▶ Uruchom segment testowy'}
            </button>
            {e2e && (
              <div style={{ marginTop: 8 }}>
                {e2e.ok ? (
                  <>
                    <div className="kv"><span className="k">Latencja (MT+TTS)</span>
                      <span className={`mono ${(e2e.totalMs ?? 0) > 2000 ? 'err-text' : 'ok-text'}`}>
                        {((e2e.totalMs ?? 0) / 1000).toFixed(2)} s
                      </span>
                    </div>
                    <div className="hint">„{e2e.translatedText}"</div>
                  </>
                ) : (
                  <div className="err-text">Blad: {e2e.error}</div>
                )}
              </div>
            )}
          </div>
        )}

        {step === 5 && (
          <div>
            <button onClick={() => void runPreflight()}>🔍 Sprawdz pre-flight</button>
            {preflight && (
              <div style={{ marginTop: 8 }}>
                <div className="kv"><span className="k">Klucze API</span><span className={preflight.keys ? 'ok-text' : 'err-text'}>{preflight.keys ? 'OK' : 'BRAK'}</span></div>
                <div className="kv"><span className="k">Profil mowcy</span><span className={preflight.profile ? 'ok-text' : 'err-text'}>{preflight.profile ? activeProfile?.name : 'BRAK'}</span></div>
                <div className="kv"><span className="k">E2E</span><span className={e2e?.ok ? 'ok-text' : 'err-text'}>{e2e?.ok ? 'zaliczony' : 'NIE zaliczony'}</span></div>
              </div>
            )}
          </div>
        )}

        <div className="dialog-actions">
          <button
            onClick={() => {
              sessionController.dispatch({ type: 'SOUNDCHECK_BACK' });
              onClose();
            }}
          >
            Anuluj
          </button>
          <button onClick={() => finish(true)} title="Tryb dev — bez gwarancji dzialania toru">
            Pomin (tryb dev)
          </button>
          {step > 0 && <button onClick={() => setStep(step - 1)}>← Wstecz</button>}
          {step < STEPS.length - 1 ? (
            <button className="primary" disabled={!stepOk[step]} onClick={() => setStep(step + 1)}>
              Dalej →
            </button>
          ) : (
            <button className="primary" disabled={!stepOk[5]} onClick={() => finish(false)}>
              ✓ Zakoncz soundcheck
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
