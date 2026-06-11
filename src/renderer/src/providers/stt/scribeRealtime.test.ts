// Testy adaptera STT na FakeWebSocket: partial -> final, commit, bledy, abort.
import { describe, expect, it } from 'vitest';
import type { SttPartial, SttSession } from '../types';
import { FakeWebSocket } from '../testUtils';
import { base64ToInt16 } from '../wsClient';
import { ScribeRealtimeStt } from './scribeRealtime';

async function setup(): Promise<{
  ws: FakeWebSocket;
  session: SttSession;
  partials: SttPartial[];
}> {
  let ws: FakeWebSocket | null = null;
  const provider = new ScribeRealtimeStt({
    apiKey: 'k-123',
    wsFactory: (url) => {
      ws = new FakeWebSocket(url);
      return ws;
    },
  });
  const partials: SttPartial[] = [];
  const sessionPromise = provider.startSession({
    signal: new AbortController().signal,
    onPartial: (p) => partials.push(p),
  });
  if (!ws) throw new Error('brak ws');
  (ws as FakeWebSocket).open();
  return { ws: ws as FakeWebSocket, session: await sessionPromise, partials };
}

describe('ScribeRealtimeStt', () => {
  it('laczy sie z model_id i kluczem w query', async () => {
    const { ws } = await setup();
    expect(ws.url).toContain('model_id=scribe_v2_realtime');
    expect(ws.url).toContain('xi-api-key=k-123');
    expect(ws.url).toContain('language_detection=true');
  });

  it('sendAudio wysyla PCM jako base64 JSON', async () => {
    const { ws, session } = await setup();
    const pcm = new Int16Array([100, -200, 300]);
    session.sendAudio(pcm);
    const msg = ws.sentJson()[0];
    expect(msg['type']).toBe('input_audio');
    const decoded = base64ToInt16(msg['audio_chunk'] as string);
    expect(Array.from(decoded)).toEqual([100, -200, 300]);
  });

  it('partial transcript trafia do onPartial z jezykiem', async () => {
    const { ws, partials } = await setup();
    ws.message({ type: 'partial_transcript', text: 'czesc wszy', language_code: 'pl' });
    expect(partials).toEqual([{ text: 'czesc wszy', language: 'pl' }]);
  });

  it('commit wysyla {type:commit} i resolvuje na final', async () => {
    const { ws, session } = await setup();
    const p = session.commit();
    expect(ws.sentJson().some((m) => m['type'] === 'commit')).toBe(true);
    ws.message({ type: 'final_transcript', text: 'czesc wszystkim', language_code: 'pl' });
    await expect(p).resolves.toEqual({ text: 'czesc wszystkim', language: 'pl' });
  });

  it('final bez tekstu uzywa ostatniego partiala (nie gubimy tresci)', async () => {
    const { ws, session } = await setup();
    ws.message({ type: 'partial_transcript', text: 'dobry wieczor', language_code: 'pl' });
    const p = session.commit();
    ws.message({ type: 'committed_transcript', text: '' });
    await expect(p).resolves.toEqual({ text: 'dobry wieczor', language: 'pl' });
  });

  it('blad serwera w trakcie commit -> PipelineError transient', async () => {
    const { ws, session } = await setup();
    const p = session.commit();
    ws.message({ type: 'error', text: 'internal' });
    await expect(p).rejects.toMatchObject({ kind: 'transient', code: 'stt_server_error' });
  });

  it('zerwanie WS w trakcie commit -> transient ws_closed', async () => {
    const { ws, session } = await setup();
    const p = session.commit();
    ws.serverClose(1006);
    await expect(p).rejects.toMatchObject({ kind: 'transient', code: 'ws_closed' });
  });

  it('close() zamyka WS bez zadnych wyjatkow', async () => {
    const { ws, session } = await setup();
    session.close();
    expect(ws.closedByClient).toBe(true);
    // po zamknieciu sendAudio jest no-opem
    session.sendAudio(new Int16Array([1]));
    expect(ws.sentJson().filter((m) => m['type'] === 'input_audio')).toHaveLength(0);
  });

  it('zmiana jezyka mid-session jest raportowana w partialach', async () => {
    const { ws, partials } = await setup();
    ws.message({ type: 'partial_transcript', text: 'czesc', language_code: 'pl' });
    ws.message({ type: 'partial_transcript', text: 'hello there', language_code: 'en' });
    expect(partials[1]).toEqual({ text: 'hello there', language: 'en' });
  });
});
