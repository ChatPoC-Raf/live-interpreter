// Testy logiki doszkalania klonu glosu (czysty TS — bez sieci/audio).
import { describe, expect, it } from 'vitest';
import { pcm16ToWavBlob, VOICE_IMPROVE, VoiceImprover } from './voiceImprover';

const RATE = VOICE_IMPROVE.sampleRate;

function speak(improver: VoiceImprover, seconds: number): void {
  improver.beginTake();
  improver.feed(new Int16Array(seconds * RATE));
  improver.commitTake();
}

function freshImprover(): VoiceImprover {
  const improver = new VoiceImprover();
  improver.reset(true);
  return improver;
}

describe('VoiceImprover — akumulacja tur', () => {
  it('zbiera tury i raportuje sekundy partii', () => {
    const improver = freshImprover();
    speak(improver, 10);
    speak(improver, 20);
    expect(improver.batchSeconds).toBe(30);
  });

  it('odrzuca tury krotsze niz minTakeSec (smieci VAD)', () => {
    const improver = freshImprover();
    speak(improver, VOICE_IMPROVE.minTakeSec - 1);
    expect(improver.batchSeconds).toBe(0);
  });

  it('discardTake (misfire) wyrzuca cala biezaca ture', () => {
    const improver = freshImprover();
    improver.beginTake();
    improver.feed(new Int16Array(10 * RATE));
    improver.discardTake();
    improver.commitTake(); // po discard nie ma czego commitowac
    expect(improver.batchSeconds).toBe(0);
  });

  it('feed bez beginTake oraz przy wylaczonej funkcji jest no-op', () => {
    const improver = freshImprover();
    improver.feed(new Int16Array(10 * RATE)); // brak beginTake
    improver.commitTake();
    expect(improver.batchSeconds).toBe(0);

    const off = new VoiceImprover();
    off.reset(false);
    speak(off, 90);
    expect(off.batchSeconds).toBe(0);
  });

  it('trim: najstarsze tury wypadaja powyzej maxBatchSec', () => {
    const improver = freshImprover();
    speak(improver, 100);
    speak(improver, 100); // 200s > max 120s -> pierwsza tura wypada
    expect(improver.batchSeconds).toBe(100);
  });
});

describe('VoiceImprover — decyzja o wysylce', () => {
  it('shouldUpload true dopiero od minBatchSec', () => {
    const improver = freshImprover();
    speak(improver, VOICE_IMPROVE.minBatchSec - 10);
    expect(improver.shouldUpload(0)).toBe(false);
    speak(improver, 10);
    expect(improver.shouldUpload(0)).toBe(true);
  });

  it('cooldown blokuje kolejna wysylke, takze po porazce', () => {
    const improver = freshImprover();
    speak(improver, 90);
    const pcm = improver.beginUpload();
    expect(pcm?.length).toBe(90 * RATE);
    improver.finishUpload(false, 1000); // porazka -> backoff, partia przepada
    speak(improver, 90);
    expect(improver.shouldUpload(1000 + VOICE_IMPROVE.cooldownMs - 1)).toBe(false);
    expect(improver.shouldUpload(1000 + VOICE_IMPROVE.cooldownMs)).toBe(true);
  });

  it('beginUpload czysci partie i blokuje rownolegla wysylke', () => {
    const improver = freshImprover();
    speak(improver, 90);
    expect(improver.beginUpload()).not.toBeNull();
    expect(improver.batchSeconds).toBe(0);
    expect(improver.beginUpload()).toBeNull(); // in-flight
    speak(improver, 90);
    expect(improver.shouldUpload(Number.MAX_SAFE_INTEGER)).toBe(false); // wciaz in-flight
  });

  it('maxUploads to twardy limit na sesje', () => {
    const improver = freshImprover();
    let now = 0;
    for (let i = 0; i < VOICE_IMPROVE.maxUploads; i++) {
      speak(improver, 90);
      now += VOICE_IMPROVE.cooldownMs;
      expect(improver.shouldUpload(now)).toBe(true);
      improver.beginUpload();
      improver.finishUpload(true, now);
    }
    speak(improver, 90);
    expect(improver.shouldUpload(now + VOICE_IMPROVE.cooldownMs)).toBe(false);
    expect(improver.hasFinalBatch()).toBe(false);
  });

  it('hasFinalBatch ignoruje cooldown (resztka na koniec sesji)', () => {
    const improver = freshImprover();
    speak(improver, 90);
    improver.beginUpload();
    improver.finishUpload(true, 1000);
    speak(improver, 90);
    expect(improver.shouldUpload(1001)).toBe(false); // cooldown trwa
    expect(improver.hasFinalBatch()).toBe(true);
  });

  it('reset zaczyna sesje od zera', () => {
    const improver = freshImprover();
    speak(improver, 90);
    improver.reset(true);
    expect(improver.batchSeconds).toBe(0);
    expect(improver.beginUpload()).toBeNull();
  });
});

describe('pcm16ToWavBlob', () => {
  it('buduje poprawny naglowek RIFF/WAVE 16 kHz mono', async () => {
    const pcm = new Int16Array([1, -2, 3, -4]);
    const blob = pcm16ToWavBlob(pcm, RATE);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + 8);
    const v = new DataView(await blob.arrayBuffer());
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe('RIFF');
    expect(String.fromCharCode(v.getUint8(8), v.getUint8(9), v.getUint8(10), v.getUint8(11))).toBe('WAVE');
    expect(v.getUint32(24, true)).toBe(RATE);
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(40, true)).toBe(8); // bajty danych
    expect(v.getInt16(44, true)).toBe(1); // pierwszy sample nietkniety
  });
});
