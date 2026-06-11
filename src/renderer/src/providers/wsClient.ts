// Pomocnik WebSocket: otwarcie z AbortSignal + konwersje base64<->PCM.
import { PipelineError, type PipelineStage } from '../core/errors';
import type { WsFactory, WsLike } from './types';

export const defaultWsFactory: WsFactory = (url) => new WebSocket(url) as unknown as WsLike;

export function openWs(
  url: string,
  stage: PipelineStage,
  signal: AbortSignal,
  factory: WsFactory,
): Promise<WsLike> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new PipelineError('transient', stage, 'aborted', 'Przerwano przed polaczeniem'));
      return;
    }
    const ws = factory(url);
    ws.binaryType = 'arraybuffer';
    const onAbort = (): void => {
      ws.close();
      reject(new PipelineError('transient', stage, 'aborted', 'Przerwano podczas laczenia'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    ws.onopen = () => {
      signal.removeEventListener('abort', onAbort);
      resolve(ws);
    };
    ws.onerror = () => {
      signal.removeEventListener('abort', onAbort);
      reject(new PipelineError('transient', stage, 'ws_connect', `Nie mozna polaczyc: ${url.split('?')[0]}`));
    };
    ws.onclose = (ev) => {
      signal.removeEventListener('abort', onAbort);
      reject(
        new PipelineError('transient', stage, 'ws_closed', `Polaczenie zamkniete (${ev.code}) przed otwarciem`),
      );
    };
  });
}

export function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function base64ToInt16(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
}
