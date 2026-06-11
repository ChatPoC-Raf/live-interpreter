// Fabryka providerow z sekretow + ustawien — jedyne miejsce skladania adapterow.
import type { LlmProviderId } from '../../../shared/ipc';
import { AnthropicStreamTranslator } from './translation/anthropicStream';
import { GeminiStreamTranslator } from './translation/geminiStream';
import { ScribeRealtimeStt } from './stt/scribeRealtime';
import { ElevenFlashWsTts } from './tts/elevenFlashWs';
import { ElevenVoices } from './voices/elevenVoices';
import type { SttProvider, TranslationProvider, TtsProvider, VoicesProvider } from './types';

export interface ProviderBundle {
  stt: SttProvider;
  translation: TranslationProvider;
  tts: TtsProvider;
  voices: VoicesProvider;
}

export function createProviders(opts: {
  elevenKey: string;
  llmKey: string;
  llmProvider: LlmProviderId;
}): ProviderBundle {
  return {
    stt: new ScribeRealtimeStt({ apiKey: opts.elevenKey }),
    translation:
      opts.llmProvider === 'anthropic'
        ? new AnthropicStreamTranslator(opts.llmKey)
        : new GeminiStreamTranslator(opts.llmKey),
    tts: new ElevenFlashWsTts({ apiKey: opts.elevenKey }),
    voices: new ElevenVoices(opts.elevenKey),
  };
}
