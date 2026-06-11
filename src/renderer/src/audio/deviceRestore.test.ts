import { describe, expect, it } from 'vitest';
import { ensureOutputStarted, restoreSavedDevices } from './deviceRestore';
import type { AudioEngine, InputChainInfo } from './audioEngine';
import type { AudioDeviceInfo } from './deviceRegistry';
import type { SettingsDto } from '../../../shared/ipc';

const DEVICES: AudioDeviceInfo[] = [
  { deviceId: 'mic-1', label: 'Mikrofon BT', groupId: 'g-mic', kind: 'audioinput' },
  { deviceId: 'spk-1', label: 'Glosnik PA', groupId: 'g-spk', kind: 'audiooutput' },
];

const FAKE_INPUT_INFO: InputChainInfo = {
  label: 'fake',
  sampleRate: 48000,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  likelyHfp: false,
};

interface StartCall {
  id: string | null;
  gain: number;
}

function fakeEngine(opts?: {
  inputRunning?: boolean;
  outputRunning?: boolean;
  failStart?: boolean;
  sinkId?: string | null;
  outputState?: AudioContextState;
}): {
  engine: Pick<
    AudioEngine,
    'getInputStream' | 'getOutputContext' | 'getOutputSinkId' | 'startInput' | 'startOutput'
  >;
  inputCalls: StartCall[];
  outputCalls: StartCall[];
  resumeCalls: () => number;
} {
  const inputCalls: StartCall[] = [];
  const outputCalls: StartCall[] = [];
  let resumed = 0;
  const ctx = opts?.outputRunning
    ? ({
        state: opts?.outputState ?? 'running',
        resume: () => {
          resumed += 1;
          return Promise.resolve();
        },
      } as unknown as AudioContext)
    : null;
  return {
    engine: {
      getInputStream: () => (opts?.inputRunning ? ({} as MediaStream) : null),
      getOutputContext: () => ctx,
      getOutputSinkId: () => opts?.sinkId ?? null,
      startInput: (id: string | null, gain: number) => {
        inputCalls.push({ id, gain });
        if (opts?.failStart) return Promise.reject(new Error('start fail'));
        return Promise.resolve(FAKE_INPUT_INFO);
      },
      startOutput: (id: string | null, gain: number) => {
        outputCalls.push({ id, gain });
        // fallback na null ma sie udac nawet gdy start urzadzenia failuje
        if (opts?.failStart && id !== null) return Promise.reject(new Error('start fail'));
        return Promise.resolve();
      },
    },
    inputCalls,
    outputCalls,
    resumeCalls: () => resumed,
  };
}

function settingsWith(patch: Partial<SettingsDto>): SettingsDto {
  return {
    llmProvider: 'gemini',
    targetLang: 'en',
    vadRedemptionMs: 800,
    vadMinSpeechMs: 250,
    playbackTailMs: 300,
    bargeInThreshold: 0.05,
    soundcheckPassed: false,
    inputDeviceId: null,
    inputDeviceLabel: null,
    inputDeviceGroupId: null,
    outputDeviceId: null,
    outputDeviceLabel: null,
    outputDeviceGroupId: null,
    inputGain: 1,
    outputGain: 0.8,
    activeProfileId: null,
    voiceImproveEnabled: true,
    ...patch,
  };
}

describe('ensureOutputStarted', () => {
  it('nie robi nic gdy wyjscie juz dziala', async () => {
    const f = fakeEngine({ outputRunning: true });
    await ensureOutputStarted(f.engine, DEVICES, { deviceId: 'spk-1', label: null, groupId: null }, 0.8);
    expect(f.outputCalls).toHaveLength(0);
  });

  it('startuje zapisany glosnik po deviceId', async () => {
    const f = fakeEngine();
    await ensureOutputStarted(f.engine, DEVICES, { deviceId: 'spk-1', label: null, groupId: null }, 0.8);
    expect(f.outputCalls).toEqual([{ id: 'spk-1', gain: 0.8 }]);
  });

  it('dopasowuje po label gdy deviceId sie zmienil', async () => {
    const f = fakeEngine();
    await ensureOutputStarted(
      f.engine,
      DEVICES,
      { deviceId: 'spk-stary', label: 'Glosnik PA', groupId: 'g-spk' },
      0.8,
    );
    expect(f.outputCalls).toEqual([{ id: 'spk-1', gain: 0.8 }]);
  });

  it('startuje wyjscie domyslne gdy zapisany glosnik zniknal', async () => {
    const f = fakeEngine();
    await ensureOutputStarted(f.engine, DEVICES, { deviceId: 'spk-brak', label: 'Inny', groupId: 'x' }, 0.8);
    expect(f.outputCalls).toEqual([{ id: null, gain: 0.8 }]);
  });

  it('startuje wyjscie domyslne gdy brak zapisanego wyboru', async () => {
    const f = fakeEngine();
    await ensureOutputStarted(f.engine, DEVICES, { deviceId: null, label: null, groupId: null }, 0.8);
    expect(f.outputCalls).toEqual([{ id: null, gain: 0.8 }]);
  });

  it('po bledzie startu zapisanego glosnika robi fallback na domyslne', async () => {
    const f = fakeEngine({ failStart: true });
    await ensureOutputStarted(f.engine, DEVICES, { deviceId: 'spk-1', label: null, groupId: null }, 0.8);
    expect(f.outputCalls).toEqual([
      { id: 'spk-1', gain: 0.8 },
      { id: null, gain: 0.8 },
    ]);
  });

  it('nie restartuje gdy aktualny sink nadal jest na liscie urzadzen', async () => {
    const f = fakeEngine({ outputRunning: true, sinkId: 'spk-1' });
    await ensureOutputStarted(f.engine, DEVICES, { deviceId: 'spk-1', label: null, groupId: null }, 0.8);
    expect(f.outputCalls).toHaveLength(0);
  });

  it('restartuje na zapisanym glosniku gdy aktualny sink zniknal z systemu', async () => {
    const f = fakeEngine({ outputRunning: true, sinkId: 'spk-odpiety' });
    await ensureOutputStarted(f.engine, DEVICES, { deviceId: 'spk-1', label: null, groupId: null }, 0.8);
    expect(f.outputCalls).toEqual([{ id: 'spk-1', gain: 0.8 }]);
  });

  it('restartuje na domyslnym gdy sink zniknal i zapisany glosnik tez nieobecny', async () => {
    const f = fakeEngine({ outputRunning: true, sinkId: 'spk-odpiety' });
    await ensureOutputStarted(f.engine, DEVICES, { deviceId: 'spk-brak', label: 'Inny', groupId: 'x' }, 0.8);
    expect(f.outputCalls).toEqual([{ id: null, gain: 0.8 }]);
  });

  it('dobudza zawieszony kontekst zamiast restartowac gdy sink jest obecny', async () => {
    const f = fakeEngine({ outputRunning: true, sinkId: 'spk-1', outputState: 'suspended' });
    await ensureOutputStarted(f.engine, DEVICES, { deviceId: 'spk-1', label: null, groupId: null }, 0.8);
    expect(f.outputCalls).toHaveLength(0);
    expect(f.resumeCalls()).toBe(1);
  });
});

describe('restoreSavedDevices', () => {
  it('bez zapisanych urzadzen niczego nie startuje', async () => {
    const f = fakeEngine();
    const patch = await restoreSavedDevices(f.engine, DEVICES, settingsWith({}));
    expect(f.inputCalls).toHaveLength(0);
    expect(f.outputCalls).toHaveLength(0);
    expect(patch).toEqual({});
  });

  it('startuje zapisane wejscie i wyjscie z gainami z ustawien', async () => {
    const f = fakeEngine();
    const patch = await restoreSavedDevices(
      f.engine,
      DEVICES,
      settingsWith({ inputDeviceId: 'mic-1', outputDeviceId: 'spk-1', inputGain: 1.2 }),
    );
    expect(f.inputCalls).toEqual([{ id: 'mic-1', gain: 1.2 }]);
    expect(f.outputCalls).toEqual([{ id: 'spk-1', gain: 0.8 }]);
    expect(patch).toEqual({});
  });

  it('re-pinuje nowy deviceId gdy dopasowanie poszlo po label+groupId', async () => {
    const f = fakeEngine();
    const patch = await restoreSavedDevices(
      f.engine,
      DEVICES,
      settingsWith({
        inputDeviceId: 'mic-stary',
        inputDeviceLabel: 'Mikrofon BT',
        inputDeviceGroupId: 'g-mic',
      }),
    );
    expect(f.inputCalls).toEqual([{ id: 'mic-1', gain: 1 }]);
    expect(patch).toEqual({ inputDeviceId: 'mic-1', inputDeviceGroupId: 'g-mic' });
  });

  it('nie startuje i nie czysci ustawien gdy urzadzenie chwilowo nieobecne', async () => {
    const f = fakeEngine();
    const patch = await restoreSavedDevices(
      f.engine,
      DEVICES,
      settingsWith({ inputDeviceId: 'mic-brak', inputDeviceLabel: 'Nieobecny', inputDeviceGroupId: 'x' }),
    );
    expect(f.inputCalls).toHaveLength(0);
    expect(patch).toEqual({});
  });

  it('czysci tylko deviceId gdy start urzadzenia sie nie powiodl', async () => {
    const f = fakeEngine({ failStart: true });
    const patch = await restoreSavedDevices(
      f.engine,
      DEVICES,
      settingsWith({ inputDeviceId: 'mic-1', inputDeviceLabel: 'Mikrofon BT' }),
    );
    expect(patch).toEqual({ inputDeviceId: null });
  });

  it('pomija start gdy silnik juz dziala', async () => {
    const f = fakeEngine({ inputRunning: true, outputRunning: true });
    const patch = await restoreSavedDevices(
      f.engine,
      DEVICES,
      settingsWith({ inputDeviceId: 'mic-1', outputDeviceId: 'spk-1' }),
    );
    expect(f.inputCalls).toHaveLength(0);
    expect(f.outputCalls).toHaveLength(0);
    expect(patch).toEqual({});
  });
});
