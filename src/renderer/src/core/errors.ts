// Taksonomia bledow pipeline'u:
//   transient — 429 / 5xx / timeout / zerwane WS -> retry z backoffem
//   terminal  — 401 / 403 / quota -> pauza + podmiana klucza (retry bezcelowy)

export type ErrorKind = 'transient' | 'terminal';
export type PipelineStage = 'stt' | 'mt' | 'tts' | 'voices' | 'audio' | 'artifacts' | 'other';

export class PipelineError extends Error {
  constructor(
    readonly kind: ErrorKind,
    readonly stage: PipelineStage,
    readonly code: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'PipelineError';
  }
}

export function classifyHttpStatus(status: number): ErrorKind {
  if (status === 429 || status === 408) return 'transient';
  if (status >= 500) return 'transient';
  return 'terminal'; // 401/402/403/404 i pozostale 4xx — retry nic nie da
}

export function toPipelineError(stage: PipelineStage, err: unknown): PipelineError {
  if (err instanceof PipelineError) return err;
  if (err instanceof DOMException && err.name === 'AbortError') {
    return new PipelineError('transient', stage, 'aborted', 'Operacja przerwana', { cause: err });
  }
  const message = err instanceof Error ? err.message : String(err);
  // Blad sieci (fetch TypeError, zerwany WebSocket) — przejsciowy.
  return new PipelineError('transient', stage, 'network', message, { cause: err });
}

export function httpError(stage: PipelineStage, status: number, body: string): PipelineError {
  const kind = classifyHttpStatus(status);
  const quota = /quota|payment|exceeded/i.test(body);
  return new PipelineError(
    quota ? 'terminal' : kind,
    stage,
    quota ? 'quota_exceeded' : `http_${status}`,
    `HTTP ${status}: ${body.slice(0, 200)}`,
  );
}
