// Testy adaptera TTS Flash v2.5 WS: BOS z kluczem, flush per zdanie, audio, abort.
import { describe, expect, it } from 'vitest';
import type { TtsSession } from '../types';
import { FakeWebSocket } from '../testUtils';
import { int16ToBase64 } from '../wsClient';
import { ElevenFlashWsTts } from './elevenFlashWs';

async function setup(signal?: AbortSignal): Promise<{
  ws: FakeWebSocket;
  session: TtsSession;
  audio: Int16Array[];
}> {
  let ws: FakeWebSocket | null = null;
  const provider = new ElevenFlashWsTts({
    apiKey: 'k-tts',
    wsFactory: (url) => {
      ws = new FakeWebSocket(url);
      return ws;
    },
  });
  const audio: Int16Array[] = [];
  const sessionPromise = provider.startSession({
    voiceId: 'voice-1',
    signal: signal ?? new AbortController().signal,
    onAudio: (pcm) => audio.push(pcm),
  });
  if (!ws) throw new Error('brak ws');
  (ws as FakeWebSocket).open();
  return { ws: ws as FakeWebSocket, session: await sessionPromise, audio };
}

describe('ElevenFlashWsTts', () => {
  it('URL zawiera voice_id, model flash i pcm_24000', async () => {
    const { ws } = await setup();
    expect(ws.url).toContain('/text-to-speech/voice-1/stream-input');
    expect(ws.url).toContain('model_id=eleven_flash_v2_5');
    expect(ws.url).toContain('output_format=pcm_24000');
  });

  it('BOS niesie xi_api_key i voice_settings (auth bez headerow)', async () => {
    const { ws } = await setup();
    const bos = ws.sentJson()[0];
    expect(bos['text']).toBe(' ');
    expect(bos['xi_api_key']).toBe('k-tts');
    expect(bos['voice_settings']).toBeDefined();
  });

  it('sendText z flush=true wysyla flage flush (granica zdania)', async () => {
    const { ws, session } = await setup();
    session.sendText('Czesc ', false);
    session.sendText('wszystkim.', true);
    const msgs = ws.sentJson();
    expect(msgs[1]).toEqual({ text: 'Czesc ' });
    expect(msgs[2]).toEqual({ text: 'wszystkim.', flush: true });
  });

  it('endInput wysyla EOS (pusty text)', async () => {
    const { ws, session } = await setup();
    session.endInput();
    expect(ws.sentJson().at(-1)).toEqual({ text: '' });
  });

  it('audio base64 jest dekodowane do Int16 i przekazywane od razu', async () => {
    const { ws, audio } = await setup();
    const pcm = new Int16Array([1000, -1000, 32000]);
    ws.message({ audio: int16ToBase64(pcm), isFinal: null });
    expect(audio).toHaveLength(1);
    expect(Array.from(audio[0])).toEqual([1000, -1000, 32000]);
  });

  it('isFinal=true resolvuje done', async () => {
    const { ws, session } = await setup();
    session.endInput();
    ws.message({ audio: null, isFinal: true });
    await expect(session.done).resolves.toBeUndefined();
  });

  it('zamkniecie WS przez serwer bez isFinal tez resolvuje done (koniec po EOS)', async () => {
    const { ws, session } = await setup();
    session.endInput();
    ws.serverClose(1000);
    await expect(session.done).resolves.toBeUndefined();
  });

  it('abort zamyka WS i rejectuje done', async () => {
    const ctrl = new AbortController();
    const { ws, session } = await setup(ctrl.signal);
    const doneCheck = expect(session.done).rejects.toMatchObject({ code: 'aborted' });
    ctrl.abort();
    expect(ws.closedByClient).toBe(true);
    await doneCheck;
  });

  it('blad serwera rejectuje done jako transient', async () => {
    const { ws, session } = await setup();
    const doneCheck = expect(session.done).rejects.toMatchObject({
      kind: 'transient',
      code: 'tts_server_error',
    });
    ws.message({ error: 'voice_not_found', message: 'nie ma' });
    await doneCheck;
  });
});
