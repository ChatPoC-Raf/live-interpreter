// Narzedzia testowe providerow: FakeWebSocket + fabryka SSE Response.
import type { WsLike } from './types';

export class FakeWebSocket implements WsLike {
  readyState = 0;
  binaryType = 'blob';
  sent: (string | ArrayBuffer)[] = [];
  closedByClient = false;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;

  constructor(readonly url: string) {}

  send(data: string | ArrayBuffer): void {
    this.sent.push(data);
  }

  close(): void {
    this.closedByClient = true;
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: '' });
  }

  // --- helpery testowe ---
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  message(payload: unknown): void {
    this.onmessage?.({ data: typeof payload === 'string' ? payload : JSON.stringify(payload) });
  }

  serverClose(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' });
  }

  sentJson(): Record<string, unknown>[] {
    return this.sent
      .filter((s): s is string => typeof s === 'string')
      .map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

export function sseResponse(events: string[], status = 200): Response {
  const body = events.map((e) => `data: ${e}\n\n`).join('');
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}
