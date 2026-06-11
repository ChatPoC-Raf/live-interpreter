// Adapter STT: ElevenLabs Scribe v2 Realtime (WebSocket).
// Jedyny silnik z deklarowana zmiana jezyka mid-session + polski + manual commit.
//
// Protokol ZWERYFIKOWANY z dokumentacja API (2026-06-11, po pierwszej realnej
// sesji — pierwotny zgadywany schemat serwer odrzucal zamykajac WS):
//  - auth: single-use token (POST /v1/single-use-token/realtime_scribe
//    z headerem xi-api-key) przekazany w query ?token= — WebSocket w renderer
//    nie moze ustawic headera, a klucz API nie powinien trafiac do URL-a
//  - klient -> serwer: WYLACZNIE input_audio_chunk
//    { message_type, audio_base_64, commit, sample_rate };
//    commit segmentu (commit_strategy=manual) = pusty chunk z commit:true
//  - serwer -> klient: pole dyskryminatora to message_type (NIE type):
//    session_started / partial_transcript / committed_transcript
//    (_with_timestamps, z language_code) / bledy { message_type, error }
import { httpError, PipelineError, toPipelineError } from '../../core/errors';
import type { FetchLike, SttFinal, SttPartial, SttProvider, SttSession, WsFactory } from '../types';
import { WS_OPEN } from '../types';
import { defaultWsFactory, int16ToBase64, openWs } from '../wsClient';

const TOKEN_URL = 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe';
const STT_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';
const MODEL_ID = 'scribe_v2_realtime';
// Spojne z audio_format=pcm_16000 — AudioEngine emituje PCM 16 kHz.
const SAMPLE_RATE = 16000;
const COMMIT_TIMEOUT_MS = 10000;
const COMMIT_MESSAGE = JSON.stringify({
  message_type: 'input_audio_chunk',
  audio_base_64: '',
  commit: true,
  sample_rate: SAMPLE_RATE,
});

// Bledy terminalne wg taksonomii core/errors (retry bezcelowy — klucz/limit).
const TERMINAL_ERROR_TYPES = /^(auth_error|quota_exceeded|unaccepted_terms)$/;
// message_type bledow serwera (error, *_error, rate_limited, queue_overflow...).
const ERROR_TYPE_PATTERN = /error|exceeded|throttled|limited|overflow|exhausted|unaccepted/i;
// Commit bez wykrytej mowy — nie awaria, tylko pusty segment (filtr EMPTY).
const NO_SPEECH_TYPE = 'insufficient_audio_activity';

interface ScribeOptions {
  apiKey: string;
  wsFactory?: WsFactory;
  fetchImpl?: FetchLike;
}

function isPartialType(t: string): boolean {
  return /partial|interim|delta/i.test(t);
}

function isFinalType(t: string): boolean {
  return /final|committed/i.test(t);
}

function extractText(msg: Record<string, unknown>): string {
  const t = msg['text'] ?? msg['transcript'] ?? '';
  return typeof t === 'string' ? t : '';
}

function extractLanguage(msg: Record<string, unknown>): string | null {
  const l = msg['language_code'] ?? msg['language'] ?? msg['detected_language'] ?? null;
  return typeof l === 'string' && l.length > 0 ? l : null;
}

function extractMessageType(msg: Record<string, unknown>): string {
  const t = msg['message_type'] ?? msg['type'] ?? '';
  return typeof t === 'string' ? t : '';
}

export class ScribeRealtimeStt implements SttProvider {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly opts: ScribeOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  /** Single-use token (15 min TTL) — jedyna droga auth WS bez headera. */
  private async fetchToken(signal: AbortSignal): Promise<string> {
    let res: Response;
    try {
      res = await this.fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'xi-api-key': this.opts.apiKey },
        signal,
      });
    } catch (err) {
      throw toPipelineError('stt', err);
    }
    if (!res.ok) throw httpError('stt', res.status, await res.text().catch(() => ''));
    const data = (await res.json().catch(() => ({}))) as { token?: unknown };
    if (typeof data.token !== 'string' || data.token.length === 0) {
      throw new PipelineError('transient', 'stt', 'token_parse', 'Brak pola token w odpowiedzi single-use-token');
    }
    return data.token;
  }

  async startSession(opts: {
    signal: AbortSignal;
    onPartial: (partial: SttPartial) => void;
  }): Promise<SttSession> {
    const token = await this.fetchToken(opts.signal);
    const params = new URLSearchParams({
      model_id: MODEL_ID,
      token,
      audio_format: 'pcm_16000',
      commit_strategy: 'manual',
      include_language_detection: 'true',
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
      const type = extractMessageType(msg);
      const errDetail = typeof msg['error'] === 'string' ? (msg['error'] as string) : null;
      if (errDetail !== null || ERROR_TYPE_PATTERN.test(type)) {
        if (type === NO_SPEECH_TYPE) {
          // Cisza zamiast mowy — domknij commit pustym finalem, bez alarmu.
          commitResolve?.({ text: '', language: lastLanguage });
          lastText = '';
        } else {
          const kind = TERMINAL_ERROR_TYPES.test(type) ? 'terminal' : 'transient';
          const detail = errDetail ?? JSON.stringify(msg).slice(0, 200);
          commitReject?.(new PipelineError(kind, 'stt', type || 'stt_server_error', detail));
        }
        commitResolve = null;
        commitReject = null;
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
          // Reset bufora — commit-timeout KOLEJNEGO segmentu nie moze
          // odtworzyc tekstu poprzedniego (duplikat tlumaczenia).
          lastText = '';
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
        ws.send(
          JSON.stringify({
            message_type: 'input_audio_chunk',
            audio_base_64: int16ToBase64(pcm),
            commit: false,
            sample_rate: SAMPLE_RATE,
          }),
        );
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
              lastText = '';
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
