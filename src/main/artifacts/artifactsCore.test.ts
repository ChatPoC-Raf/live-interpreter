// Testy artefaktow append-only + crash recovery (drill: kill w polowie sesji).
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactsManager } from './artifactsCore';

const META = {
  sessionId: '2026-06-11-1200',
  startedAt: '2026-06-11T12:00:00Z',
  targetLang: 'en',
  profileName: 'Test',
  voiceId: 'v1',
};

let base: string;
let mgr: ArtifactsManager;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'li-artifacts-'));
  mgr = new ArtifactsManager(base);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('ArtifactsManager — happy path', () => {
  it('start tworzy strukture sesji z naglowkiem WAV', () => {
    const { dir } = mgr.start(META);
    expect(existsSync(join(dir, 'session.json'))).toBe(true);
    expect(existsSync(join(dir, 'segments.jsonl'))).toBe(true);
    expect(statSync(join(dir, 'original.wav')).size).toBe(44);
    expect(existsSync(join(dir, 'tts'))).toBe(true);
  });

  it('appendEvent dopisuje wiersze JSONL po kazdym zdarzeniu', () => {
    const { dir } = mgr.start(META);
    mgr.appendEvent({ kind: 'speech_start', segmentNo: 1 });
    mgr.appendEvent({ kind: 'segment_done', segmentNo: 1, originalText: 'a', translatedText: 'b' });
    const rows = readFileSync(join(dir, 'segments.jsonl'), 'utf8').trim().split('\n');
    expect(rows).toHaveLength(2);
    expect(JSON.parse(rows[0])).toMatchObject({ kind: 'speech_start', segmentNo: 1 });
  });

  it('finalize lata naglowek WAV i zapisuje summary + transcript', () => {
    const { dir } = mgr.start(META);
    mgr.appendPcm(Buffer.alloc(3200)); // 100 ms @16k
    mgr.appendEvent({
      kind: 'segment_done',
      segmentNo: 1,
      sourceLang: 'pl',
      originalText: 'czesc',
      translatedText: 'hello',
    });
    mgr.finalize({ closedAt: '2026-06-11T12:30:00Z', segmentsTotal: 1 });

    const wav = readFileSync(join(dir, 'original.wav'));
    expect(wav.readUInt32LE(40)).toBe(3200);
    expect(wav.readUInt32LE(4)).toBe(36 + 3200);
    const meta = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'));
    expect(meta.summary.segmentsTotal).toBe(1);
    expect(readFileSync(join(dir, 'transcript.txt'), 'utf8')).toContain('-> hello');
  });

  it('saveTts zapisuje WAV 24k per segment z numeracja NNN', () => {
    const { dir } = mgr.start(META);
    mgr.saveTts(7, Buffer.alloc(4800));
    const wav = readFileSync(join(dir, 'tts', '007.wav'));
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt32LE(40)).toBe(4800);
  });

  it('exportZip pakuje cala sesje', () => {
    const { dir } = mgr.start(META);
    mgr.appendEvent({ kind: 'x' });
    mgr.finalize({ closedAt: 'now', segmentsTotal: 0 });
    const { zipPath } = mgr.exportZip(dir);
    expect(existsSync(zipPath)).toBe(true);
    expect(statSync(zipPath).size).toBeGreaterThan(0);
  });
});

describe('ArtifactsManager — crash recovery (kill w polowie sesji)', () => {
  it('sesja bez finalize jest odzyskiwana: WAV zalatany, flaga recovered, transcript', () => {
    const { dir } = mgr.start(META);
    mgr.appendPcm(Buffer.alloc(1600));
    mgr.appendEvent({
      kind: 'segment_done',
      segmentNo: 1,
      sourceLang: 'pl',
      originalText: 'przed crashem',
      translatedText: 'before crash',
    });
    // BRAK finalize — symulacja killa. Nowy manager = nowy start procesu.
    const fresh = new ArtifactsManager(base);
    const recovered = fresh.recoverAll();
    expect(recovered).toHaveLength(1);
    expect(recovered[0].sessionId).toBe(META.sessionId);

    const wav = readFileSync(join(dir, 'original.wav'));
    expect(wav.readUInt32LE(40)).toBe(1600); // naglowek zalatany z dlugosci pliku
    const meta = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'));
    expect(meta.recovered).toBe(true);
    expect(readFileSync(join(dir, 'transcript.txt'), 'utf8')).toContain('before crash');
  });

  it('sesja zamknieta poprawnie NIE jest ruszana przy recovery', () => {
    mgr.start(META);
    mgr.finalize({ closedAt: 'now', segmentsTotal: 0 });
    const fresh = new ArtifactsManager(base);
    expect(fresh.recoverAll()).toHaveLength(0);
  });

  it('uszkodzony wiersz JSONL nie wywraca transcriptu (reszta zostaje)', () => {
    const { dir } = mgr.start(META);
    mgr.appendEvent({ kind: 'segment_done', segmentNo: 1, originalText: 'ok', translatedText: 'fine' });
    // recznie dopisany uszkodzony wiersz (symulacja crasha w polowie zapisu)
    appendFileSync(join(dir, 'segments.jsonl'), '{"kind":"segment_done","orig', 'utf8');
    const fresh = new ArtifactsManager(base);
    fresh.recoverAll();
    expect(readFileSync(join(dir, 'transcript.txt'), 'utf8')).toContain('-> fine');
  });
});
