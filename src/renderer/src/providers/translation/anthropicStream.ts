// Adapter MT: Claude Haiku 4.5 przez Messages API ze streamingiem (SSE).
import { httpError, toPipelineError } from '../../core/errors';
import { parseSse } from '../sse';
import type { FetchLike, TranslationProvider, TranslationRequest } from '../types';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt';

const MODEL = 'claude-haiku-4-5';
const URL = 'https://api.anthropic.com/v1/messages';

export class AnthropicStreamTranslator implements TranslationProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init),
  ) {}

  async *translateStream(req: TranslationRequest): AsyncGenerator<string, void, undefined> {
    let res: Response;
    try {
      res = await this.fetchImpl(URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        signal: req.signal,
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1500,
          stream: true,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildUserPrompt(req) }],
        }),
      });
    } catch (err) {
      throw toPipelineError('mt', err);
    }
    if (!res.ok) {
      throw httpError('mt', res.status, await res.text().catch(() => ''));
    }
    if (!res.body) {
      throw httpError('mt', 502, 'Brak strumienia odpowiedzi');
    }
    for await (const payload of parseSse(res.body, req.signal)) {
      let msg: unknown;
      try {
        msg = JSON.parse(payload);
      } catch {
        continue;
      }
      const m = msg as { type?: string; delta?: { type?: string; text?: string } };
      if (m.type === 'content_block_delta' && m.delta?.type === 'text_delta' && m.delta.text) {
        yield m.delta.text;
      }
    }
  }
}
