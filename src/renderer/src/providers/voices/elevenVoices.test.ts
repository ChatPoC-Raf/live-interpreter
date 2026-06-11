// Testy adaptera glosow ElevenLabs (fake fetch — zero sieci).
import { describe, expect, it } from 'vitest';
import { PipelineError } from '../../core/errors';
import { ElevenVoices } from './elevenVoices';

interface Captured {
  url: string;
  init?: RequestInit;
}

function fakeFetch(response: Response, captured: Captured[]): (url: string, init?: RequestInit) => Promise<Response> {
  return (url, init) => {
    captured.push({ url, init });
    return Promise.resolve(response);
  };
}

describe('ElevenVoices.addSamples', () => {
  it('wysyla multipart POST na /voices/:id/edit z name + plikiem', async () => {
    const captured: Captured[] = [];
    const voices = new ElevenVoices('k1', fakeFetch(new Response('{}', { status: 200 }), captured));
    await voices.addSamples({ voiceId: 'v 1', name: 'Jan', sample: new Blob([new Uint8Array(4)]) });

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe('https://api.elevenlabs.io/v1/voices/v%201/edit');
    expect(captured[0].init?.method).toBe('POST');
    const form = captured[0].init?.body as FormData;
    expect(form.get('name')).toBe('Jan');
    expect(form.get('files')).toBeInstanceOf(Blob);
    expect((captured[0].init?.headers as Record<string, string>)['xi-api-key']).toBe('k1');
  });

  it('rzuca PipelineError na blad HTTP', async () => {
    const voices = new ElevenVoices('k1', fakeFetch(new Response('quota', { status: 429 }), []));
    await expect(
      voices.addSamples({ voiceId: 'v1', name: 'Jan', sample: new Blob() }),
    ).rejects.toBeInstanceOf(PipelineError);
  });
});

describe('ElevenVoices.createIvc', () => {
  it('zwraca voiceId + flage weryfikacji', async () => {
    const res = new Response(JSON.stringify({ voice_id: 'abc', requires_verification: true }), { status: 200 });
    const voices = new ElevenVoices('k1', fakeFetch(res, []));
    const result = await voices.createIvc({ name: 'Jan', description: 'd', sample: new Blob() });
    expect(result).toEqual({ voiceId: 'abc', requiresVerification: true });
  });
});
