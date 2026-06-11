// Testy adaptera STT na FakeWebSocket + fake fetch (single-use token).
// Protokol zweryfikowany z dokumentacja Scribe v2 Realtime (2026-06-11):
// message_type / input_audio_chunk / commit jako flaga chunka / token w query.
import { describe, expect, it } from 'vitest';
import type { FetchLike, SttPartial, SttSession } from '../types';
import { FakeWebSocket } from '../testUtils';
import { base64ToInt16 } from '../wsClient';
import { ScribeRealtimeStt } from './scribeRealtime';

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function tokenFetch(calls: FetchCall[], status = 200): FetchLike {
  return async (url, init) => {
    calls.push({ url, init });
    if (status !== 200) return new Response('denied', { status });
    return new Response(JSON.stringify({ token: 'tok-1' }), { status: 200 });
  };
}

async function setup(): Promise<{
  ws: FakeWebSocket;
  session: SttSession;
  partials: SttPartial[];
  fetchCalls: FetchCall[];
}> {
  let ws: FakeWebSocket | null = null;
  const fetchCalls: FetchCall[] = [];
  const provider = new ScribeRealtimeStt({
    apiKey: 'k-123',
    fetchImpl: tokenFetch(fetchCalls),
    wsFactory: (url) => {
      ws = new FakeWebSocket(url);
      // Mikro-task: openWs musi zdazyc podpiac onopen zanim otworzymy.
      queueMicrotask(() => (ws as FakeWebSocket).open());
      return ws;
    },
  });
  const partials: SttPartial[] = [];
  const session = await provider.startSession({
    signal: new AbortController().signal,
    onPartial: (p) => partials.push(p),
  });
  if (!ws) throw new Error('brak ws');
  return { ws: ws as FakeWebSocket, session, partials, fetchCalls };
}

function audioChunks(ws: FakeWebSocket): Record<string, unknown>[] {
  return ws.sentJson().filter((m) => m['message_type'] === 'input_audio_chunk');
}

describe('ScribeRealtimeStt', () => {
  it('pobiera single-use token POST-em z xi-api-key w headerze', async () => {
    const { fetchCalls } = await setup();
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe('https://api.elevenlabs.io/v1/single-use-token/realtime_scribe');
    expect(fetchCalls[0].init?.method).toBe('POST');
    expect((fetchCalls[0].init?.headers as Record<string, string>)['xi-api-key']).toBe('k-123');
  });

  it('laczy sie z token w query — klucz API NIGDY nie trafia do URL-a', async () => {
    const { ws } = await setup();
    expect(ws.url).toContain('model_id=scribe_v2_realtime');
    expect(ws.url).toContain('token=tok-1');
    expect(ws.url).toContain('commit_strategy=manual');
    expect(ws.url).toContain('audio_format=pcm_16000');
    expect(ws.url).toContain('include_language_detection=true');
    expect(ws.url).not.toContain('k-123');
    expect(ws.url).not.toContain('xi-api-key');
  });

  it('odmowa tokenu (401) -> PipelineError terminal, bez polaczenia WS', async () => {
    const calls: FetchCall[] = [];
    const provider = new ScribeRealtimeStt({
      apiKey: 'k-bad',
      fetchImpl: tokenFetch(calls, 401),
      wsFactory: () => {
        throw new Error('WS nie powinien byc tworzony bez tokenu');
      },
    });
    await expect(
      provider.startSession({ signal: new AbortController().signal, onPartial: () => undefined }),
    ).rejects.toMatchObject({ kind: 'terminal', stage: 'stt' });
  });

  it('sendAudio wysyla input_audio_chunk z base64, sample_rate i commit:false', async () => {
    const { ws, session } = await setup();
    const pcm = new Int16Array([100, -200, 300]);
    session.sendAudio(pcm);
    const msg = audioChunks(ws)[0];
    expect(msg['commit']).toBe(false);
    expect(msg['sample_rate']).toBe(16000);
    const decoded = base64ToInt16(msg['audio_base_64'] as string);
    expect(Array.from(decoded)).toEqual([100, -200, 300]);
  });

  it('partial_transcript trafia do onPartial z jezykiem', async () => {
    const { ws, partials } = await setup();
    ws.message({ message_type: 'partial_transcript', text: 'czesc wszy', language_code: 'pl' });
    expect(partials).toEqual([{ text: 'czesc wszy', language: 'pl' }]);
  });

  it('commit = pusty input_audio_chunk z commit:true; committed_transcript resolvuje', async () => {
    const { ws, session } = await setup();
    const p = session.commit();
    const commitMsg = audioChunks(ws).find((m) => m['commit'] === true);
    expect(commitMsg).toBeDefined();
    expect(commitMsg?.['audio_base_64']).toBe('');
    ws.message({ message_type: 'committed_transcript', text: 'czesc wszystkim', language_code: 'pl' });
    await expect(p).resolves.toEqual({ text: 'czesc wszystkim', language: 'pl' });
  });

  it('final bez tekstu uzywa ostatniego partiala (nie gubimy tresci)', async () => {
    const { ws, session, partials } = await setup();
    ws.message({ message_type: 'partial_transcript', text: 'dobry wieczor', language_code: 'pl' });
    expect(partials).toHaveLength(1);
    const p = session.commit();
    ws.message({ message_type: 'committed_transcript', text: '' });
    await expect(p).resolves.toEqual({ text: 'dobry wieczor', language: 'pl' });
  });

  it('drugi commit NIE odtwarza tekstu pierwszego (reset bufora po finalu)', async () => {
    const { ws, session } = await setup();
    const p1 = session.commit();
    ws.message({ message_type: 'committed_transcript', text: 'pierwsze zdanie', language_code: 'pl' });
    await expect(p1).resolves.toMatchObject({ text: 'pierwsze zdanie' });
    const p2 = session.commit();
    ws.message({ message_type: 'committed_transcript', text: '' });
    await expect(p2).resolves.toMatchObject({ text: '' });
  });

  it('blad serwera w trakcie commit -> PipelineError transient z typem serwera', async () => {
    const { ws, session } = await setup();
    const p = session.commit();
    ws.message({ message_type: 'transcriber_error', error: 'internal' });
    await expect(p).rejects.toMatchObject({ kind: 'transient', code: 'transcriber_error' });
  });

  it('auth_error / quota_exceeded -> PipelineError terminal', async () => {
    const { ws, session } = await setup();
    const p = session.commit();
    ws.message({ message_type: 'auth_error', error: 'invalid token' });
    await expect(p).rejects.toMatchObject({ kind: 'terminal', code: 'auth_error' });
  });

  it('insufficient_audio_activity -> pusty final zamiast awarii', async () => {
    const { ws, session } = await setup();
    const p = session.commit();
    ws.message({ message_type: 'insufficient_audio_activity', error: 'no speech' });
    await expect(p).resolves.toEqual({ text: '', language: null });
  });

  it('zerwanie WS w trakcie commit -> transient ws_closed', async () => {
    const { ws, session } = await setup();
    const p = session.commit();
    ws.serverClose(1006);
    await expect(p).rejects.toMatchObject({ kind: 'transient', code: 'ws_closed' });
  });

  it('close() zamyka WS; po zamknieciu sendAudio jest no-opem', async () => {
    const { ws, session } = await setup();
    session.close();
    expect(ws.closedByClient).toBe(true);
    session.sendAudio(new Int16Array([1]));
    expect(audioChunks(ws)).toHaveLength(0);
  });

  it('session_started jest ignorowany (nie jest bledem ani transkryptem)', async () => {
    const { ws, partials } = await setup();
    ws.message({ message_type: 'session_started', session_id: 's-1', config: {} });
    expect(partials).toHaveLength(0);
  });

  it('zmiana jezyka mid-session jest raportowana w partialach', async () => {
    const { ws, partials } = await setup();
    ws.message({ message_type: 'partial_transcript', text: 'czesc', language_code: 'pl' });
    ws.message({ message_type: 'partial_transcript', text: 'hello there', language_code: 'en' });
    expect(partials[1]).toEqual({ text: 'hello there', language: 'en' });
  });
});
