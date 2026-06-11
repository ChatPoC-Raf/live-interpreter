// Glosy ElevenLabs: lista + Instant Voice Cloning (IVC) + usuwanie.
// IVC: probka 1-2 min -> voice_id wielokrotnego uzytku (profil mowcy).
// requires_verification sygnalizuje voice-captcha (niepewnosc z planu — Unit 2).
import { httpError, toPipelineError } from '../../core/errors';
import type { CreateVoiceResult, FetchLike, VoiceInfo, VoicesProvider } from '../types';

const BASE = 'https://api.elevenlabs.io/v1';

export class ElevenVoices implements VoicesProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init),
  ) {}

  private headers(): Record<string, string> {
    return { 'xi-api-key': this.apiKey };
  }

  async list(): Promise<VoiceInfo[]> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${BASE}/voices`, { headers: this.headers() });
    } catch (err) {
      throw toPipelineError('voices', err);
    }
    if (!res.ok) throw httpError('voices', res.status, await res.text().catch(() => ''));
    const data = (await res.json()) as {
      voices?: { voice_id: string; name: string; category?: string }[];
    };
    return (data.voices ?? []).map((v) => ({
      voiceId: v.voice_id,
      name: v.name,
      category: v.category ?? 'unknown',
    }));
  }

  async createIvc(opts: { name: string; description: string; sample: Blob }): Promise<CreateVoiceResult> {
    const form = new FormData();
    form.append('name', opts.name);
    form.append('description', opts.description);
    form.append('files', opts.sample, 'sample.webm');
    let res: Response;
    try {
      res = await this.fetchImpl(`${BASE}/voices/add`, {
        method: 'POST',
        headers: this.headers(),
        body: form,
      });
    } catch (err) {
      throw toPipelineError('voices', err);
    }
    if (!res.ok) throw httpError('voices', res.status, await res.text().catch(() => ''));
    const data = (await res.json()) as { voice_id: string; requires_verification?: boolean };
    return {
      voiceId: data.voice_id,
      requiresVerification: data.requires_verification === true,
    };
  }

  async delete(voiceId: string): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${BASE}/voices/${encodeURIComponent(voiceId)}`, {
        method: 'DELETE',
        headers: this.headers(),
      });
    } catch (err) {
      throw toPipelineError('voices', err);
    }
    if (!res.ok) throw httpError('voices', res.status, await res.text().catch(() => ''));
  }
}
