// Ustawienia: klucze API (safeStorage — nigdy plaintext), provider MT,
// jezyk docelowy, parametry VAD/ogona. Podmiana klucza dziala tez w
// AWARIA_TERMINALNA (KEY_REPLACED -> PAUZA) bez restartu sesji.
import { useEffect, useState, type ReactElement } from 'react';
import type { SecretsPresenceDto, SettingsDto } from '../../../../shared/ipc';
import { sessionController, useSession } from '../../state/useSession';

interface Props {
  settings: SettingsDto;
  onSettingsChange: (patch: Partial<SettingsDto>) => void;
  onClose: () => void;
}

const TARGET_LANGS = ['pl', 'en', 'de', 'fr', 'es', 'it', 'uk', 'cs'];

export function SettingsDialog({ settings, onSettingsChange, onClose }: Props): ReactElement {
  const session = useSession();
  const [presence, setPresence] = useState<SecretsPresenceDto>({ hasElevenKey: false, hasLlmKey: false });
  const [elevenKey, setElevenKey] = useState('');
  const [llmKey, setLlmKey] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void window.live.getSecretsPresence().then(setPresence);
  }, []);

  const saveKeys = async (): Promise<void> => {
    const patch: { elevenKey?: string; llmKey?: string } = {};
    if (elevenKey.trim()) patch.elevenKey = elevenKey.trim();
    if (llmKey.trim()) patch.llmKey = llmKey.trim();
    if (Object.keys(patch).length === 0) return;
    setPresence(await window.live.saveSecrets(patch));
    setElevenKey('');
    setLlmKey('');
    setSaved(true);
    if (session.machine.phase === 'AWARIA_TERMINALNA') {
      await sessionController.reloadProvidersAfterKeySwap();
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Ustawienia</h2>

        <h3>Klucze API (szyfrowane safeStorage)</h3>
        <label>
          Klucz ElevenLabs {presence.hasElevenKey ? '· zapisany ✓' : '· BRAK'}
        </label>
        <input
          type="password"
          placeholder={presence.hasElevenKey ? '(bez zmian — wpisz aby podmienic)' : 'xi-...'}
          value={elevenKey}
          onChange={(e) => setElevenKey(e.target.value)}
        />
        <label>
          Klucz LLM ({settings.llmProvider === 'gemini' ? 'Gemini' : 'Anthropic'}){' '}
          {presence.hasLlmKey ? '· zapisany ✓' : '· BRAK'}
        </label>
        <input
          type="password"
          placeholder={presence.hasLlmKey ? '(bez zmian — wpisz aby podmienic)' : 'klucz API'}
          value={llmKey}
          onChange={(e) => setLlmKey(e.target.value)}
        />
        <div style={{ marginTop: 8 }}>
          <button className="primary" onClick={() => void saveKeys()} disabled={!elevenKey.trim() && !llmKey.trim()}>
            Zapisz klucze
          </button>
          {saved && <span className="ok-text" style={{ marginLeft: 10 }}>Zapisano ✓</span>}
          {session.machine.phase === 'AWARIA_TERMINALNA' && (
            <div className="warn-text" style={{ marginTop: 6 }}>
              Sesja w awarii terminalnej — zapis klucza podmieni go w locie i przejdzie do PAUZY.
            </div>
          )}
        </div>

        <h3>Tlumaczenie</h3>
        <label>Provider LLM</label>
        <select
          value={settings.llmProvider}
          onChange={(e) => onSettingsChange({ llmProvider: e.target.value as SettingsDto['llmProvider'] })}
        >
          <option value="gemini">Gemini 2.5 Flash-Lite (zalecany — najszybszy TTFT)</option>
          <option value="anthropic">Claude Haiku 4.5</option>
        </select>
        <label>Jezyk docelowy (publicznosc)</label>
        <select value={settings.targetLang} onChange={(e) => onSettingsChange({ targetLang: e.target.value })}>
          {TARGET_LANGS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>

        <h3>Glos (klon mowcy)</h3>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={settings.voiceImproveEnabled}
            onChange={(e) => onSettingsChange({ voiceImproveEnabled: e.target.checked })}
          />
          Doszkalaj klon glosu w trakcie wystapienia
        </label>
        <div className="hint">
          Aplikacja zbiera czysta mowe wykladowcy (tylko gdy mikrofon otwarty) i co kilka minut
          dosyla ja do klonu ElevenLabs — glos tlumaczenia brzmi coraz lepiej w miare mowienia.
        </div>

        <h3>Rytm (VAD)</h3>
        <label>Cisza konczaca ture: {settings.vadRedemptionMs} ms</label>
        <input
          type="range"
          min="400"
          max="1500"
          step="50"
          value={settings.vadRedemptionMs}
          onChange={(e) => onSettingsChange({ vadRedemptionMs: Number(e.target.value) })}
        />
        <label>Minimalna mowa (filtr stukniec): {settings.vadMinSpeechMs} ms</label>
        <input
          type="range"
          min="150"
          max="1000"
          step="50"
          value={settings.vadMinSpeechMs}
          onChange={(e) => onSettingsChange({ vadMinSpeechMs: Number(e.target.value) })}
        />
        <label>Ogon po odtworzeniu: {settings.playbackTailMs} ms</label>
        <input
          type="range"
          min="100"
          max="1000"
          step="50"
          value={settings.playbackTailMs}
          onChange={(e) => onSettingsChange({ playbackTailMs: Number(e.target.value) })}
        />
        <div className="hint">Zmiany VAD dzialaja od NASTEPNEJ sesji (brama tworzona przy starcie).</div>

        <div className="dialog-actions">
          <button onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
