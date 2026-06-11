// Rejestr urzadzen audio: enumeracja + pinowanie po deviceId z fallbackiem
// label+groupId (deviceId potrafi sie zmienic miedzy sesjami/portami USB).

export interface AudioDeviceInfo {
  deviceId: string;
  label: string;
  groupId: string;
  kind: 'audioinput' | 'audiooutput';
}

export interface SavedDevice {
  deviceId: string | null;
  label: string | null;
  groupId: string | null;
}

/** Czysta logika dopasowania zapisanego urzadzenia do aktualnej listy. */
export function resolveDevice(
  devices: AudioDeviceInfo[],
  kind: 'audioinput' | 'audiooutput',
  saved: SavedDevice,
): AudioDeviceInfo | null {
  const ofKind = devices.filter((d) => d.kind === kind);
  if (saved.deviceId) {
    const byId = ofKind.find((d) => d.deviceId === saved.deviceId);
    if (byId) return byId;
  }
  if (saved.label && saved.groupId) {
    const byLabelGroup = ofKind.find((d) => d.label === saved.label && d.groupId === saved.groupId);
    if (byLabelGroup) return byLabelGroup;
  }
  if (saved.label) {
    const byLabel = ofKind.find((d) => d.label === saved.label);
    if (byLabel) return byLabel;
  }
  return null;
}

export async function listDevices(): Promise<AudioDeviceInfo[]> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === 'audioinput' || d.kind === 'audiooutput')
    .filter((d) => d.deviceId !== '') // bez uprawnien deviceId bywa pusty
    .map((d) => ({
      deviceId: d.deviceId,
      label: d.label || `(${d.kind === 'audioinput' ? 'mikrofon' : 'glosnik'} bez nazwy)`,
      groupId: d.groupId,
      kind: d.kind as 'audioinput' | 'audiooutput',
    }));
}

export function onDeviceChange(cb: () => void): () => void {
  navigator.mediaDevices.addEventListener('devicechange', cb);
  return () => navigator.mediaDevices.removeEventListener('devicechange', cb);
}
