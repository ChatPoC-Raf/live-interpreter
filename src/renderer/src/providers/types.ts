// Porty providerow — interfejsy niezalezne od vendora. Implementacje:
// stt/scribeRealtime, translation/geminiStream|anthropicStream, tts/elevenFlashWs,
// voices/elevenVoices. Wszystko z AbortSignal i wstrzykiwalnym transportem (testy).

export interface SttPartial {
  text: string;
  language: string | null;
}

export interface SttFinal {
  text: string;
  language: string | null;
}

export interface SttSession {
  /** Streamuj PCM 16 kHz Int16 w trakcie mowy. */
  sendAudio(pcm: Int16Array): void;
  /** Domknij segment (pauza) — zwraca finalny transkrypt. */
  commit(): Promise<SttFinal>;
  close(): void;
}

export interface SttProvider {
  startSession(opts: {
    signal: AbortSignal;
    onPartial: (partial: SttPartial) => void;
  }): Promise<SttSession>;
}

export interface TranslationRequest {
  text: string;
  sourceLang: string | null; // null = auto
  targetLang: string;
  /** Poprzednie segmenty (oryginal -> tlumaczenie) jako kontekst spójnosci. */
  context: { original: string; translated: string }[];
  signal: AbortSignal;
}

export interface TranslationProvider {
  /** Strumien tokenow tlumaczenia. */
  translateStream(req: TranslationRequest): AsyncGenerator<string, void, undefined>;
}

export interface TtsSession {
  /** Wyslij fragment tekstu; flush wymusza synteze zdania (granica chunka). */
  sendText(text: string, flush: boolean): void;
  /** Koniec tekstu — po tym sesja dostarczy reszte audio i sie zamknie. */
  endInput(): void;
  /** Zamkniecie awaryjne (abort). */
  close(): void;
  /** Resolves gdy WSZYSTKIE audio dotarlo (po endInput). */
  done: Promise<void>;
}

export interface TtsProvider {
  startSession(opts: {
    voiceId: string;
    signal: AbortSignal;
    onAudio: (pcm24k: Int16Array) => void;
  }): Promise<TtsSession>;
}

export interface VoiceInfo {
  voiceId: string;
  name: string;
  category: string;
}

export interface CreateVoiceResult {
  voiceId: string;
  /** ElevenLabs moze wymagac weryfikacji (voice captcha) — sygnalizujemy w UI. */
  requiresVerification: boolean;
}

export interface VoicesProvider {
  list(): Promise<VoiceInfo[]>;
  createIvc(opts: { name: string; description: string; sample: Blob }): Promise<CreateVoiceResult>;
  delete(voiceId: string): Promise<void>;
}

/** Minimalny interfejs WebSocket — wstrzykiwany w testach. */
export interface WsLike {
  readonly readyState: number;
  binaryType: string;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
}

export type WsFactory = (url: string) => WsLike;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const WS_OPEN = 1;
