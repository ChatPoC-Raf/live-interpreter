// Adapter STT: ElevenLabs Scribe v2 Realtime (WebSocket).
// Jedyny silnik z deklarowana zmiana jezyka mid-session + polski + manual commit.
//
// UWAGA (spike Unit 2): dokladny schemat wiadomosci websocketa weryfikowany
// empirycznie na realnym API — parser jest celowo TOLERANCYJNY (rozne nazwy
// pol w partial/final), a stale protokolu zebrane ponizej w jednym miejscu.
import { PipelineError } from '../../core/errors';
import type { SttFinal, SttPartial, SttProvider, SttSession, WsFactory } from '../types';
import { WS_OPEN } from '../types';
import { defaultWsFactory, int16ToBase64, openWs } from '../wsClient';

const STT_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';
const MODEL_ID = 'scribe_v2_realtime';
const COMMIT_MESSAGE = JSON.stringify({ type: 'commit' });
const COMMIT_TIMEOUT_MS = 10000;

interface ScribeOptions {
  apiKey: string;
  wsFactory?: WsFactory;
}

function isPartialType(t: string): boolean {
  return /partial|interim|delta/i.test(t);
}

function isFinalType(t: string): boolean {
  return /final|committed|commit/i.test(t);
}

function extractText(msg: Record<string, unknown>): string {
  const t = msg['text'] ?? msg['transcript'] ?? '';
  return typeof t === 'string' ? t : '';
}

function extractLanguage(msg: Record<string, unknown>): string | null {
  const l = msg['language_code'] ?? msg['language'] ?? msg['detected_language'] ?? null;
  return typeof l === 'string' && l.length > 0 ? l : null;
}

export class ScribeRealtimeStt implements SttProvider {
  constructor(private readonly opts: ScribeOptions) {}

  async startSession(opts: {
    signal: AbortSignal;
    onPartial: (partial: SttPartial) => void;
  }): Promise<SttSession> {
    const params = new URLSearchParams({
      model_id: MODEL_ID,
      audio_format: 'pcm_16000',
      language_detection: 'true',
      'xi-api-key': this.opts.apiKey,
    });
    const ws = await openWs(
      `${STT_URL}?${params.toString()}`,
      'stt',
      opts.signal,
      this.opts.wsFactory ?? defaultWsFactory,
    );

    let lastText = '';
    let lastLanguage: string | null = null;
    let commitResolve: ((f: SttFinal) => void) | null = null;
    let commitReject: ((e: PipelineError) => void) | null = null;
    let closed = false;

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(ev.data) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = typeof msg['type'] === 'string' ? (msg['type'] as string) : '';
      if (/error/i.test(type)) {
        const detail = extractText(msg) || JSON.stringify(msg).slice(0, 200);
        const err = new PipelineError('transient', 'stt', 'stt_server_error', detail);
        commitReject?.(err);
        commitReject = null;
        commitResolve = null;
        return;
      }
      const text = extractText(msg);
      const language = extractLanguage(msg) ?? lastLanguage;
      if (isFinalType(type)) {
        if (text) {
          lastText = text;
          lastLanguage = language;
        }
        if (commitResolve) {
          commitResolve({ text: lastText, language: lastLanguage });
          commitResolve = null;
          commitReject = null;
        }
      } else if (isPartialType(type) && text) {
        lastText = text;
        lastLanguage = language;
        opts.onPartial({ text, language });
      }
    };

    ws.onclose = () => {
      closed = true;
      commitReject?.(
        new PipelineError('transient', 'stt', 'ws_closed', 'Polaczenie STT zamkniete w trakcie'),
      );
      commitReject = null;
      commitResolve = null;
    };
    ws.onerror = () => {
      // onclose przyjdzie zaraz po — obsluga tam
    };

    const session: SttSession = {
      sendAudio: (pcm: Int16Array): void => {
        if (closed || ws.readyState !== WS_OPEN) return;
        ws.send(JSON.stringify({ type: 'input_audio', audio_chunk: int16ToBase64(pcm) }));
      },
      commit: (): Promise<SttFinal> => {
        if (closed || ws.readyState !== WS_OPEN) {
          return Promise.reject(
            new PipelineError('transient', 'stt', 'ws_closed', 'Sesja STT zamknieta przed commit'),
          );
        }
        return new Promise<SttFinal>((resolve, reject) => {
          const timer = setTimeout(() => {
            // Brak final z serwera — uzyj ostatniego partiala (lepsze niz utrata tresci).
            if (commitResolve) {
              commitResolve = null;
              commitReject = null;
              resolve({ text: lastText, language: lastLanguage });
            }
          }, COMMIT_TIMEOUT_MS);
          commitResolve = (f) => {
            clearTimeout(timer);
            resolve(f);
          };
          commitReject = (e) => {
            clearTimeout(timer);
            reject(e);
          };
          ws.send(COMMIT_MESSAGE);
        });
      },
      close: (): void => {
        closed = true;
        commitResolve = null;
        commitReject = null;
        ws.onclose = null;
        ws.close();
      },
    };
    return session;
  }
}
