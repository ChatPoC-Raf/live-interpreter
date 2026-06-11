// Adapter MT: Gemini 2.5 Flash-Lite przez streamGenerateContent (SSE).
// Tokeny yieldowane od razu — plyna prosto do sesji TTS.
import { httpError, toPipelineError } from '../../core/errors';
import { parseSse } from '../sse';
import type { FetchLike, TranslationProvider, TranslationRequest } from '../types';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt';

const MODEL = 'gemini-2.5-flash-lite';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export class GeminiStreamTranslator implements TranslationProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init),
  ) {}

  async *translateStream(req: TranslationRequest): AsyncGenerator<string, void, undefined> {
    let res: Response;
    try {
      res = await this.fetchImpl(
        `${BASE}/${MODEL}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: req.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ role: 'user', parts: [{ text: buildUserPrompt(req) }] }],
            generationConfig: { temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } },
          }),
        },
      );
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
      const text = extractGeminiText(msg);
      if (text) yield text;
    }
  }
}

function extractGeminiText(msg: unknown): string {
  if (typeof msg !== 'object' || msg === null) return '';
  const candidates = (msg as { candidates?: { content?: { parts?: { text?: string }[] } }[] })
    .candidates;
  const parts = candidates?.[0]?.content?.parts;
  if (!parts) return '';
  return parts.map((p) => p.text ?? '').join('');
}
