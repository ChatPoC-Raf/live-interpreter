// Panel audio: wybor urzadzen, gain wej/wyj, VU, ostrzezenie HFP, ton testowy.
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { SettingsDto } from '../../../../shared/ipc';
import { listDevices, onDeviceChange, type AudioDeviceInfo } from '../../audio/deviceRegistry';
import { HFP_WARNING } from '../../audio/hfp';
import { vuPercent } from '../../audio/vu';
import { sessionController, useSession } from '../../state/useSession';

interface Props {
  settings: SettingsDto;
  onSettingsChange: (patch: Partial<SettingsDto>) => void;
  disabled: boolean;
}

export function DevicePanel({ settings, onSettingsChange, disabled }: Props): ReactElement {
  const session = useSession();
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);

  const refresh = useCallback(async () => {
    setDevices(await listDevices());
  }, []);

  useEffect(() => {
    void refresh();
    return onDeviceChange(() => void refresh());
  }, [refresh]);

  const inputs = devices.filter((d) => d.kind === 'audioinput');
  const outputs = devices.filter((d) => d.kind === 'audiooutput');

  const applyInput = async (deviceId: string): Promise<void> => {
    const dev = inputs.find((d) => d.deviceId === deviceId);
    onSettingsChange({
      inputDeviceId: deviceId,
      inputDeviceLabel: dev?.label ?? null,
      inputDeviceGroupId: dev?.groupId ?? null,
    });
    await sessionController.engine.startInput(deviceId, settings.inputGain);
  };

  const applyOutput = async (deviceId: string): Promise<void> => {
    const dev = outputs.find((d) => d.deviceId === deviceId);
    onSettingsChange({
      outputDeviceId: deviceId,
      outputDeviceLabel: dev?.label ?? null,
      outputDeviceGroupId: dev?.groupId ?? null,
    });
    await sessionController.engine.startOutput(deviceId, settings.outputGain);
  };

  return (
    <div>
      <h2>Audio</h2>
      <label>Mikrofon (mowca)</label>
      <select
        value={settings.inputDeviceId ?? ''}
        disabled={disabled}
        onChange={(e) => void applyInput(e.target.value)}
      >
        <option value="">— wybierz mikrofon —</option>
        {inputs.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label}
          </option>
        ))}
      </select>
      <div className="gain-row">
        <span className="hint">Gain</span>
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={settings.inputGain}
          onChange={(e) => {
            const v = Number(e.target.value);
            onSettingsChange({ inputGain: v });
            sessionController.engine.setInputGain(v);
          }}
        />
        <span className="mono hint">{settings.inputGain.toFixed(2)}</span>
      </div>
      <div className="vu">
        <div className="vu-fill" style={{ width: `${vuPercent(session.inputLevel)}%` }} />
      </div>
      {session.inputInfo?.likelyHfp && <div className="device-warning">⚠ {HFP_WARNING}</div>}
      {session.inputInfo && (
        <div className="hint" style={{ marginTop: 6 }}>
          {session.inputInfo.label} · {session.inputInfo.sampleRate ?? '?'} Hz · EC/NS/AGC:{' '}
          {session.inputInfo.echoCancellation || session.inputInfo.noiseSuppression || session.inputInfo.autoGainControl
            ? 'WLACZONE (zle!)'
            : 'off'}
        </div>
      )}

      <h3>Wyjscie (glosnik PA)</h3>
      <select
        value={settings.outputDeviceId ?? ''}
        disabled={disabled}
        onChange={(e) => void applyOutput(e.target.value)}
      >
        <option value="">— wybierz glosnik —</option>
        {outputs.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label}
          </option>
        ))}
      </select>
      <div className="gain-row">
        <span className="hint">Gain</span>
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={settings.outputGain}
          onChange={(e) => {
            const v = Number(e.target.value);
            onSettingsChange({ outputGain: v });
            sessionController.engine.setOutputGain(v);
          }}
        />
        <span className="mono hint">{settings.outputGain.toFixed(2)}</span>
      </div>
      <button
        style={{ marginTop: 8 }}
        onClick={() => void sessionController.engine.playTestTone()}
        disabled={!settings.outputDeviceId}
      >
        🔊 Ton testowy
      </button>
    </div>
  );
}
