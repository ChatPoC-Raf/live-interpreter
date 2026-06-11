import { describe, expect, it } from 'vitest';
import { PipelineError } from '../core/errors';
import { backoffDelay, withRetry } from './retry';

const noSleep = async (): Promise<void> => undefined;

describe('backoffDelay', () => {
  it('wykladniczy: base * 2^attempt', () => {
    expect(backoffDelay(500, 0)).toBe(500);
    expect(backoffDelay(500, 1)).toBe(1000);
    expect(backoffDelay(500, 2)).toBe(2000);
  });
});

describe('withRetry', () => {
  it('blad przejsciowy jest ponawiany i konczy sie sukcesem', async () => {
    let calls = 0;
    const delays: number[] = [];
    const result = await withRetry(
      'mt',
      async () => {
        calls += 1;
        if (calls < 3) throw new PipelineError('transient', 'mt', 'http_500', 'boom');
        return 'ok';
      },
      { retries: 3, baseDelayMs: 100, sleep: async (ms) => void delays.push(ms) },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(delays).toEqual([100, 200]);
  });

  it('blad terminalny NIE jest ponawiany', async () => {
    let calls = 0;
    await expect(
      withRetry(
        'tts',
        async () => {
          calls += 1;
          throw new PipelineError('terminal', 'tts', 'quota_exceeded', 'quota');
        },
        { retries: 3, baseDelayMs: 1, sleep: noSleep },
      ),
    ).rejects.toMatchObject({ kind: 'terminal', code: 'quota_exceeded' });
    expect(calls).toBe(1);
  });

  it('abort NIE jest ponawiany', async () => {
    let calls = 0;
    await expect(
      withRetry(
        'stt',
        async () => {
          calls += 1;
          throw new PipelineError('transient', 'stt', 'aborted', 'stop');
        },
        { retries: 3, baseDelayMs: 1, sleep: noSleep },
      ),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(calls).toBe(1);
  });

  it('wyczerpanie prob rzuca ostatni blad', async () => {
    let calls = 0;
    const attempts: number[] = [];
    await expect(
      withRetry(
        'mt',
        async () => {
          calls += 1;
          throw new PipelineError('transient', 'mt', 'http_429', 'rate');
        },
        { retries: 2, baseDelayMs: 1, sleep: noSleep, onRetry: (a) => void attempts.push(a) },
      ),
    ).rejects.toMatchObject({ code: 'http_429' });
    expect(calls).toBe(3); // 1 + 2 retry
    expect(attempts).toEqual([1, 2]);
  });

  it('niesklasyfikowany wyjatek jest mapowany na PipelineError', async () => {
    await expect(
      withRetry('other', async () => Promise.reject(new Error('zwykly blad')), {
        retries: 0,
        baseDelayMs: 1,
        sleep: noSleep,
      }),
    ).rejects.toBeInstanceOf(PipelineError);
  });
});
