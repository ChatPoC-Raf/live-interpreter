import { describe, expect, it } from 'vitest';
import type { AudioDeviceInfo } from './deviceRegistry';
import { resolveDevice } from './deviceRegistry';

const DEVICES: AudioDeviceInfo[] = [
  { deviceId: 'mic-1', label: 'Rode Wireless GO', groupId: 'g1', kind: 'audioinput' },
  { deviceId: 'mic-2', label: 'Mikrofon laptopa', groupId: 'g2', kind: 'audioinput' },
  { deviceId: 'spk-1', label: 'Glosnik PA (USB)', groupId: 'g3', kind: 'audiooutput' },
];

describe('resolveDevice', () => {
  it('dopasowuje po deviceId (pin)', () => {
    const r = resolveDevice(DEVICES, 'audioinput', { deviceId: 'mic-2', label: null, groupId: null });
    expect(r?.deviceId).toBe('mic-2');
  });

  it('fallback po label+groupId gdy deviceId sie zmienil', () => {
    const r = resolveDevice(DEVICES, 'audioinput', {
      deviceId: 'stary-id',
      label: 'Rode Wireless GO',
      groupId: 'g1',
    });
    expect(r?.deviceId).toBe('mic-1');
  });

  it('fallback po samym label gdy groupId tez sie zmienil', () => {
    const r = resolveDevice(DEVICES, 'audioinput', {
      deviceId: 'x',
      label: 'Rode Wireless GO',
      groupId: 'inna-grupa',
    });
    expect(r?.deviceId).toBe('mic-1');
  });

  it('null gdy urzadzenie zniknelo (odpiete)', () => {
    const r = resolveDevice(DEVICES, 'audioinput', {
      deviceId: 'x',
      label: 'DJI Mic',
      groupId: 'g9',
    });
    expect(r).toBeNull();
  });

  it('nie miesza kierunkow wejscie/wyjscie', () => {
    const r = resolveDevice(DEVICES, 'audiooutput', {
      deviceId: 'mic-1',
      label: 'Rode Wireless GO',
      groupId: 'g1',
    });
    expect(r).toBeNull();
  });
});
