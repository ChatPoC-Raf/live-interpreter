// Biblioteka profili mowcow: nagranie/upload probki -> walidacja jakosci ->
// IVC (ElevenLabs) -> odsluch testowy -> zapis profilu z notatka zgody (RODO).
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { ProfileDto, SettingsDto } from '../../../../shared/ipc';
import { ElevenVoices } from '../../providers/voices/elevenVoices';

interface Props {
  settings: SettingsDto;
  onSettingsChange: (patch: Partial<SettingsDto>) => void;
  onClose: () => void;
}

const MIN_SAMPLE_SEC = 30;
const TARGET_SAMPLE_SEC = 90;

export function ProfilesDialog({ settings, onSettingsChange, onClose }: Props): ReactElement {
  const [profiles, setProfiles] = useState<ProfileDto[]>([]);
  const [name, setName] = useState('');
  const [consent, setConsent] = useState('');
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [sample, setSample] = useState<Blob | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captchaWarning, setCaptchaWarning] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void window.live.listProfiles().then(setProfiles);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recorderRef.current?.stop();
    };
  }, []);

  const startRecording = async (): Promise<void> => {
    setError(null);
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: settings.inputDeviceId ? { deviceId: { exact: settings.inputDeviceId } } : true,
    });
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => {
      setSample(new Blob(chunks, { type: 'audio/webm' }));
      for (const t of stream.getTracks()) t.stop();
    };
    rec.start();
    recorderRef.current = rec;
    setRecording(true);
    setSeconds(0);
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  };

  const stopRecording = (): void => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const createProfile = async (): Promise<void> => {
    if (!sample || !name.trim()) return;
    if (seconds > 0 && seconds < MIN_SAMPLE_SEC) {
      setError(`Probka za krotka (${seconds}s) — minimum ${MIN_SAMPLE_SEC}s, celuj w ${TARGET_SAMPLE_SEC}s.`);
      return;
    }
    setBusy('Tworze klon glosu (IVC)…');
    setError(null);
    try {
      const secrets = await window.live.getSecrets();
      if (!secrets.elevenKey) throw new Error('Brak klucza ElevenLabs w Ustawieniach');
      const voices = new ElevenVoices(secrets.elevenKey);
      const result = await voices.createIvc({
        name: name.trim(),
        description: `Profil mowcy Live Interpreter (zgoda: ${consent.trim() || 'brak notatki'})`,
        sample,
      });
      setCaptchaWarning(result.requiresVerification);
      const profile: ProfileDto = {
        id: result.voiceId,
        name: name.trim(),
        voiceId: result.voiceId,
        consentNote: consent.trim(),
        createdAt: new Date().toISOString(),
      };
      setProfiles(await window.live.saveProfile(profile));
      setName('');
      setConsent('');
      setSample(null);
      setSeconds(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const previewVoice = async (voiceId: string): Promise<void> => {
    setBusy('Generuje probke odsluchu…');
    setError(null);
    try {
      const secrets = await window.live.getSecrets();
      if (!secrets.elevenKey) throw new Error('Brak klucza ElevenLabs');
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: { 'xi-api-key': secrets.elevenKey, 'content-type': 'application/json' },
          body: JSON.stringify({
            text: 'To jest test klonu glosu. Tak bedzie brzmiec tlumaczenie.',
            model_id: 'eleven_flash_v2_5',
          }),
        },
      );
      if (!res.ok) throw new Error(`Odsluch nieudany: HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const deleteProfile = async (p: ProfileDto): Promise<void> => {
    if (!confirm(`Usunac profil "${p.name}"? Klon glosu zostanie tez usuniety z ElevenLabs.`)) return;
    try {
      const secrets = await window.live.getSecrets();
      if (secrets.elevenKey) {
        await new ElevenVoices(secrets.elevenKey).delete(p.voiceId).catch(() => undefined);
      }
    } finally {
      setProfiles(await window.live.deleteProfile(p.id));
      if (settings.activeProfileId === p.id) onSettingsChange({ activeProfileId: null });
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Profile mowcow (klony glosu)</h2>

        {profiles.map((p) => (
          <div key={p.id} className="profile-row">
            <label className="active-pick" title="Ten profil bedzie uzyty w sesji i spike'u">
              <input
                type="radio"
                name="activeProfile"
                checked={settings.activeProfileId === p.id}
                onChange={() => onSettingsChange({ activeProfileId: p.id })}
              />
              Aktywny
            </label>
            <div className="grow">
              <b>{p.name}</b>
              <div className="hint">
                voice_id: {p.voiceId} · {new Date(p.createdAt).toLocaleDateString()}
                {p.consentNote && ` · zgoda: ${p.consentNote}`}
              </div>
            </div>
            <button onClick={() => void previewVoice(p.voiceId)}>▶ Odsluch</button>
            <button className="danger" onClick={() => void deleteProfile(p)}>
              Usun
            </button>
          </div>
        ))}
        {profiles.length === 0 && <div className="hint">Brak profili — nagraj probke ponizej.</div>}

        <h3>Nowy profil</h3>
        <label>Nazwa mowcy</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="np. Jan Kowalski" />
        <label>Notatka zgody na klonowanie (RODO — kto, kiedy, jak wyrazil zgode)</label>
        <input
          value={consent}
          onChange={(e) => setConsent(e.target.value)}
          placeholder="np. zgoda ustna 2026-06-11 przed soundcheckiem"
        />
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
          {!recording ? (
            <button onClick={() => void startRecording()}>🎙 Nagraj probke (1-2 min)</button>
          ) : (
            <button className="danger" onClick={stopRecording}>
              ⏹ Stop ({seconds}s)
            </button>
          )}
          <span className="hint">albo</span>
          <input
            type="file"
            accept="audio/*"
            style={{ width: 'auto' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setSample(f);
                setSeconds(0);
              }
            }}
          />
        </div>
        {sample && !recording && (
          <div className="ok-text" style={{ marginTop: 6 }}>
            Probka gotowa{seconds > 0 ? ` (${seconds}s)` : ''} — mozna tworzyc klon.
          </div>
        )}
        {recording && seconds < MIN_SAMPLE_SEC && (
          <div className="warn-text">Mow dalej — minimum {MIN_SAMPLE_SEC}s, optymalnie {TARGET_SAMPLE_SEC}s.</div>
        )}
        {error && <div className="err-text" style={{ marginTop: 6 }}>{error}</div>}
        {busy && <div className="hint" style={{ marginTop: 6 }}>{busy}</div>}
        {captchaWarning && (
          <div className="warn-text" style={{ marginTop: 6 }}>
            ElevenLabs zglasza wymog weryfikacji glosu (voice captcha) — sprawdz panel ElevenLabs
            zanim uzyjesz profilu na evencie.
          </div>
        )}

        <div className="dialog-actions">
          <button
            className="primary"
            disabled={!sample || !name.trim() || busy !== null}
            onClick={() => void createProfile()}
          >
            Utworz klon glosu
          </button>
          <button onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
