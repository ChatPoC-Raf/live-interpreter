// Testy adapterow MT (Gemini + Anthropic) na fake fetch z SSE.
import { describe, expect, it } from 'vitest';
import type { TranslationRequest } from '../types';
import { sseResponse } from '../testUtils';
import { AnthropicStreamTranslator } from './anthropicStream';
import { GeminiStreamTranslator } from './geminiStream';
import { buildUserPrompt } from './prompt';

function req(text = 'Dzien dobry panstwu'): TranslationRequest {
  return {
    text,
    sourceLang: 'pl',
    targetLang: 'en',
    context: [],
    signal: new AbortController().signal,
  };
}

async function collect(gen: AsyncGenerator<string, void, undefined>): Promise<string[]> {
  const out: string[] = [];
  for await (const t of gen) out.push(t);
  return out;
}

describe('GeminiStreamTranslator', () => {
  it('yielduje tokeny z kolejnych chunkow SSE', async () => {
    const t = new GeminiStreamTranslator('key-g', async () =>
      sseResponse([
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Good ' }] } }] }),
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'morning.' }] } }] }),
      ]),
    );
    expect(await collect(t.translateStream(req()))).toEqual(['Good ', 'morning.']);
  });

  it('429 -> PipelineError transient', async () => {
    const t = new GeminiStreamTranslator('key-g', async () => new Response('rate', { status: 429 }));
    await expect(collect(t.translateStream(req()))).rejects.toMatchObject({
      kind: 'transient',
      code: 'http_429',
    });
  });

  it('odpowiedz z "quota" w tresci -> terminal', async () => {
    const t = new GeminiStreamTranslator(
      'key-g',
      async () => new Response('quota exceeded for project', { status: 403 }),
    );
    await expect(collect(t.translateStream(req()))).rejects.toMatchObject({
      kind: 'terminal',
      code: 'quota_exceeded',
    });
  });

  it('blad sieci -> transient network', async () => {
    const t = new GeminiStreamTranslator('key-g', async () => {
      throw new TypeError('fetch failed');
    });
    await expect(collect(t.translateStream(req()))).rejects.toMatchObject({
      kind: 'transient',
      code: 'network',
    });
  });
});

describe('AnthropicStreamTranslator', () => {
  it('yielduje tylko text_delta', async () => {
    const t = new AnthropicStreamTranslator('key-a', async () =>
      sseResponse([
        JSON.stringify({ type: 'message_start' }),
        JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Guten ' } }),
        JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Morgen.' } }),
        JSON.stringify({ type: 'message_stop' }),
      ]),
    );
    expect(await collect(t.translateStream(req()))).toEqual(['Guten ', 'Morgen.']);
  });

  it('401 -> terminal (podmiana klucza, nie retry)', async () => {
    const t = new AnthropicStreamTranslator('zly-klucz', async () => new Response('unauthorized', { status: 401 }));
    await expect(collect(t.translateStream(req()))).rejects.toMatchObject({ kind: 'terminal' });
  });
});

describe('buildUserPrompt', () => {
  it('zawiera tekst, jezyki i kontekst poprzednich segmentow', () => {
    const p = buildUserPrompt({
      text: 'To jest test',
      sourceLang: 'pl',
      targetLang: 'en',
      context: [{ original: 'Witam', translated: 'Welcome' }],
    });
    expect(p).toContain('To jest test');
    expect(p).toContain('"pl"');
    expect(p).toContain('"en"');
    expect(p).toContain('"Witam" -> "Welcome"');
  });

  it('bez sourceLang prosi o auto-detekcje', () => {
    const p = buildUserPrompt({ text: 'x', sourceLang: null, targetLang: 'en', context: [] });
    expect(p).toContain('automatycznie');
  });

  it('kontekst przyciety do 3 ostatnich segmentow', () => {
    const ctx = Array.from({ length: 6 }, (_, i) => ({ original: `o${i}`, translated: `t${i}` }));
    const p = buildUserPrompt({ text: 'x', sourceLang: null, targetLang: 'en', context: ctx });
    expect(p).not.toContain('o2');
    expect(p).toContain('o3');
    expect(p).toContain('o5');
  });
});
