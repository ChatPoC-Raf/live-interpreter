// Adapter TTS: ElevenLabs Flash v2.5 przez WebSocket stream-input.
// Input-streaming tekstu (tokeny MT plyna prosto do TTS), flush per zdanie,
// audio wraca jako PCM 24 kHz (base64) — natychmiast do kolejki odtwarzania.
// Eleven v3 NIE ma WebSocketa — nie uzywac (decyzja z planu).
import { PipelineError } from '../../core/errors';
import type { TtsProvider, TtsSession, WsFactory } from '../types';
import { WS_OPEN } from '../types';
import { base64ToInt16, defaultWsFactory, openWs } from '../wsClient';

const TTS_URL_BASE = 'wss://api.elevenlabs.io/v1/text-to-speech';
const MODEL_ID = 'eleven_flash_v2_5';
const OUTPUT_FORMAT = 'pcm_24000';

interface FlashOptions {
  apiKey: string;
  wsFactory?: WsFactory;
  voiceSettings?: { stability: number; similarity_boost: number };
}

export class ElevenFlashWsTts implements TtsProvider {
  constructor(private readonly opts: FlashOptions) {}

  async startSession(opts: {
    voiceId: string;
    signal: AbortSignal;
    onAudio: (pcm24k: Int16Array) => void;
  }): Promise<TtsSession> {
    const params = new URLSearchParams({
      model_id: MODEL_ID,
      output_format: OUTPUT_FORMAT,
      auto_mode: 'true', // generuj od razu po flush/zdaniu — minimalna latencja
      inactivity_timeout: '60',
    });
    const ws = await openWs(
      `${TTS_URL_BASE}/${encodeURIComponent(opts.voiceId)}/stream-input?${params.toString()}`,
      'tts',
      opts.signal,
      this.opts.wsFactory ?? defaultWsFactory,
    );

    let closed = false;
    let doneResolve: () => void = () => undefined;
    let doneReject: (e: PipelineError) => void = () => undefined;
    const done = new Promise<void>((resolve, reject) => {
      doneResolve = resolve;
      doneReject = reject;
    });

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(ev.data) as Record<string, unknown>;
      } catch {
        return;
      }
      if (msg['error'] !== undefined && msg['error'] !== null) {
        doneReject(
          new PipelineError('transient', 'tts', 'tts_server_error', JSON.stringify(msg).slice(0, 200)),
        );
        return;
      }
      const audio = msg['audio'];
      if (typeof audio === 'string' && audio.length > 0) {
        opts.onAudio(base64ToInt16(audio));
      }
      if (msg['isFinal'] === true) {
        doneResolve();
      }
    };
    ws.onclose = () => {
      if (!closed) {
        // Zamkniecie bez isFinal — traktuj jako koniec (server konczy po EOS).
        doneResolve();
      }
      closed = true;
    };

    // BOS — klucz API w pierwszej wiadomosci (przegladarkowy WebSocket nie ma headerow).
    ws.send(
      JSON.stringify({
        text: ' ',
        voice_settings: this.opts.voiceSettings ?? { stability: 0.5, similarity_boost: 0.8 },
        xi_api_key: this.opts.apiKey,
      }),
    );

    const abortHandler = (): void => {
      closed = true;
      ws.onclose = null;
      ws.close();
      doneReject(new PipelineError('transient', 'tts', 'aborted', 'TTS przerwany'));
    };
    opts.signal.addEventListener('abort', abortHandler, { once: true });

    return {
      sendText: (text: string, flush: boolean): void => {
        if (closed || ws.readyState !== WS_OPEN) return;
        ws.send(JSON.stringify(flush ? { text, flush: true } : { text }));
      },
      endInput: (): void => {
        if (closed || ws.readyState !== WS_OPEN) return;
        ws.send(JSON.stringify({ text: '' }));
      },
      close: (): void => {
        if (closed) return;
        closed = true;
        ws.onclose = null;
        ws.close();
        doneResolve();
      },
      done,
    };
  }
}
