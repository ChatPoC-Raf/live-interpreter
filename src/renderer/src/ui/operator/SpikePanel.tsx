// Spike latencji (Unit 2 — GATE): N segmentow testowych przez realny tor
// MT -> TTS (klon) -> playback, median/p95 + breakdown. Wyniki do schowka
// (wklej do docs/spike-results.md). Pelne E2E z mikrofonem = realna sesja
// (latencja per segment widoczna w feedzie).
import { useState, type ReactElement } from 'react';
import type { ProfileDto, SettingsDto } from '../../../../shared/ipc';
import { median, p95 } from '../../orchestrator/latency';
import { runE2ECheck, type E2ECheckResult } from '../../orchestrator/soundcheck';
import { sessionController } from '../../state/useSession';

interface Props {
  settings: SettingsDto;
  profiles: ProfileDto[];
  onSettingsChange: (patch: Partial<SettingsDto>) => void;
  onOpenProfiles: () => void;
  onClose: () => void;
}

const RUNS = 10;

export function SpikePanel({ settings, profiles, onSettingsChange, onOpenProfiles, onClose }: Props): ReactElement {
  const [results, setResults] = useState<E2ECheckResult[]>([]);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const profile = profiles.find((p) => p.id === settings.activeProfileId) ?? null;

  const run = async (): Promise<void> => {
    if (!profile) return;
    setRunning(true);
    setResults([]);
    const acc: E2ECheckResult[] = [];
    for (let i = 0; i < RUNS; i++) {
      const r = await runE2ECheck(sessionController.engine, {
        voiceId: profile.voiceId,
        targetLang: settings.targetLang,
        llmProvider: settings.llmProvider,
      });
      acc.push(r);
      setResults([...acc]);
      if (!r.ok) break; // blad konfiguracyjny — dalsze proby bez sensu
    }
    setRunning(false);
  };

  const totals = results.filter((r) => r.ok && r.totalMs !== null).map((r) => r.totalMs as number);
  const med = median(totals);
  const p = p95(totals);

  const copyReport = async (): Promise<void> => {
    const report = {
      date: new Date().toISOString(),
      runs: results.length,
      okRuns: totals.length,
      medianMs: med,
      p95Ms: p,
      gate2sPassed: med !== null && med <= 2000,
      llmProvider: settings.llmProvider,
      targetLang: settings.targetLang,
      note: 'Pomiar MT+TTS+playback (bez VAD/STT — te dochodza ~450-650 ms wg budzetu planu)',
      results: results.map((r) => ({ ok: r.ok, totalMs: r.totalMs, breakdown: r.breakdown, error: r.error })),
    };
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    setCopied(true);
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Spike latencji (Unit 2 — GATE ≤2 s)</h2>
        <p className="hint">
          {RUNS} segmentow testowych przez realne API (MT + TTS klonem + playback). Wymaga kluczy,
          profilu i uruchomionego wyjscia audio. Wyniki wklej do docs/spike-results.md.
        </p>
        {profiles.length > 0 ? (
          <>
            <label>Aktywny profil mowcy (klon glosu do testu)</label>
            <select
              value={settings.activeProfileId ?? ''}
              onChange={(e) => onSettingsChange({ activeProfileId: e.target.value || null })}
              disabled={running}
            >
              <option value="">— wybierz profil —</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </>
        ) : (
          <div className="warn-text" style={{ marginBottom: 8 }}>
            Brak profili mowcow — najpierw nagraj probke glosu (1-2 min) i utworz klon.{' '}
            <button onClick={onOpenProfiles}>Otworz Profile</button>
          </div>
        )}
        <button className="primary" disabled={running || !profile} onClick={() => void run()} style={{ marginTop: 8 }}>
          {running ? `Mierze… (${results.length}/${RUNS})` : '▶ Uruchom spike'}
        </button>

        {results.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="kv">
              <span className="k">Median (MT+TTS+playback)</span>
              <span className={`mono ${med !== null && med <= 2000 ? 'ok-text' : 'err-text'}`}>
                {med !== null ? `${(med / 1000).toFixed(2)} s` : '—'}
              </span>
            </div>
            <div className="kv">
              <span className="k">p95</span>
              <span className="mono">{p !== null ? `${(p / 1000).toFixed(2)} s` : '—'}</span>
            </div>
            <div className="kv">
              <span className="k">GATE ≤2 s (z marginesem na VAD+STT ~0.5 s)</span>
              <span className={med !== null && med <= 1500 ? 'ok-text' : 'warn-text'}>
                {med === null ? '—' : med <= 1500 ? 'PASS' : med <= 2000 ? 'NA STYK' : 'FAIL'}
              </span>
            </div>
            <h3>Przebiegi</h3>
            {results.map((r, i) => (
              <div key={i} className="kv">
                <span className="k">#{i + 1}</span>
                <span className={`mono ${r.ok ? '' : 'err-text'}`}>
                  {r.ok ? `${((r.totalMs ?? 0) / 1000).toFixed(2)} s` : r.error}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="dialog-actions">
          {totals.length > 0 && (
            <button onClick={() => void copyReport()}>{copied ? 'Skopiowano ✓' : '📋 Kopiuj raport JSON'}</button>
          )}
          <button onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
