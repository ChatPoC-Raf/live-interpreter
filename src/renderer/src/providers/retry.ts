// Retry z wykladniczym backoffem — TYLKO dla bledow przejsciowych.
// Terminalne (401/quota) i abort przechodza od razu wyzej.
import { PipelineError, toPipelineError, type PipelineStage } from '../core/errors';

export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, error: PipelineError) => void;
}

export function backoffDelay(baseMs: number, attempt: number): number {
  return baseMs * Math.pow(2, attempt);
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(
  stage: PipelineStage,
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  let lastError: PipelineError | null = null;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    if (opts.signal?.aborted) {
      throw new PipelineError('transient', stage, 'aborted', 'Przerwano');
    }
    try {
      return await fn();
    } catch (err) {
      const pe = toPipelineError(stage, err);
      if (pe.kind === 'terminal' || pe.code === 'aborted' || attempt === opts.retries) {
        throw pe;
      }
      lastError = pe;
      opts.onRetry?.(attempt + 1, pe);
      await sleep(backoffDelay(opts.baseDelayMs, attempt));
    }
  }
  throw lastError ?? new PipelineError('transient', stage, 'unknown', 'withRetry bez prob');
}
