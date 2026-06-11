// Pomiar poziomu sygnalu: RMS -> dBFS -> procent na VU. Czysta matematyka.

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

const DBFS_FLOOR = -90;

export function rmsToDbfs(value: number): number {
  if (value <= 0) return DBFS_FLOOR;
  return Math.max(DBFS_FLOOR, 20 * Math.log10(value));
}

/** Mapowanie dBFS [-60..0] -> [0..100] do paska VU. */
export function vuPercent(rmsValue: number): number {
  const db = rmsToDbfs(rmsValue);
  const pct = ((db + 60) / 60) * 100;
  return Math.min(100, Math.max(0, pct));
}

/** Detekcja clippingu probki Int16/Float32 (|s| bliskie 1.0). */
export function hasClipping(samples: Float32Array, threshold = 0.985): boolean {
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) >= threshold) return true;
  }
  return false;
}
