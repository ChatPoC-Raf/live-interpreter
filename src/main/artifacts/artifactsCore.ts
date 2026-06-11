// Artefakty sesji — append-only od t0. Struktura katalogu sesji:
//   sessions/<sessionId>/session.json     — meta + summary (closedAt po finalize)
//   sessions/<sessionId>/segments.jsonl   — append po kazdym zdarzeniu
//   sessions/<sessionId>/original.wav     — PCM 16k mono, strumieniowo
//   sessions/<sessionId>/tts/NNN.wav      — audio tlumaczen (PCM 24k mono)
// Crash recovery: sesja bez closedAt -> latanie naglowka WAV + flaga recovered.
// Czysta logika fs (bez Electrona) — testowana na katalogach tymczasowych.
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import type { RecoveredSessionDto, SessionMetaDto, SessionSummaryDto } from '../../shared/ipc';
import { buildWavHeader, wavSizesForFileLength } from './wav';

const ORIGINAL_SAMPLE_RATE = 16000;
const TTS_SAMPLE_RATE = 24000;

export class ArtifactsManager {
  private sessionDir: string | null = null;
  private wavFd: number | null = null;
  private wavBytes = 0;

  constructor(private readonly baseDir: string) {
    mkdirSync(baseDir, { recursive: true });
  }

  get currentDir(): string | null {
    return this.sessionDir;
  }

  start(meta: SessionMetaDto): { dir: string } {
    const dir = join(this.baseDir, meta.sessionId);
    mkdirSync(join(dir, 'tts'), { recursive: true });
    writeFileSync(join(dir, 'session.json'), JSON.stringify({ meta }, null, 2), 'utf8');
    writeFileSync(join(dir, 'segments.jsonl'), '', 'utf8');
    this.wavFd = openSync(join(dir, 'original.wav'), 'w');
    writeSync(this.wavFd, buildWavHeader(ORIGINAL_SAMPLE_RATE, 0));
    this.wavBytes = 0;
    this.sessionDir = dir;
    return { dir };
  }

  appendEvent(event: Record<string, unknown>): void {
    if (!this.sessionDir) return;
    const row = JSON.stringify({ at: new Date().toISOString(), ...event });
    appendFileSync(join(this.sessionDir, 'segments.jsonl'), row + '\n', 'utf8');
  }

  appendPcm(chunk: Buffer): void {
    if (this.wavFd === null) return;
    writeSync(this.wavFd, chunk);
    this.wavBytes += chunk.byteLength;
  }

  saveTts(segmentNo: number, pcm24k: Buffer): void {
    if (!this.sessionDir) return;
    const name = String(segmentNo).padStart(3, '0') + '.wav';
    const wav = Buffer.concat([buildWavHeader(TTS_SAMPLE_RATE, pcm24k.byteLength), pcm24k]);
    writeFileSync(join(this.sessionDir, 'tts', name), wav);
  }

  finalize(summary: SessionSummaryDto): void {
    if (!this.sessionDir) return;
    if (this.wavFd !== null) {
      patchWavHeader(this.wavFd, this.wavBytes);
      closeSync(this.wavFd);
      this.wavFd = null;
    }
    const metaPath = join(this.sessionDir, 'session.json');
    const data = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
    data['summary'] = summary;
    writeFileSync(metaPath, JSON.stringify(data, null, 2), 'utf8');
    this.writeTranscript(this.sessionDir);
    this.sessionDir = null;
    this.wavBytes = 0;
  }

  /** transcript.txt — czytelny zapis oryginal/tlumaczenie z segments.jsonl. */
  private writeTranscript(dir: string): void {
    const lines: string[] = [];
    const jsonl = readFileSync(join(dir, 'segments.jsonl'), 'utf8');
    for (const row of jsonl.split('\n')) {
      if (!row.trim()) continue;
      try {
        const ev = JSON.parse(row) as Record<string, unknown>;
        if (ev['kind'] === 'segment_done') {
          lines.push(
            `#${String(ev['segmentNo'])} [${String(ev['sourceLang'] ?? '?')}] ${String(ev['originalText'] ?? '')}`,
            `   -> ${String(ev['translatedText'] ?? '')}`,
            '',
          );
        }
      } catch {
        // uszkodzony wiersz (np. crash w polowie zapisu) — pomijamy, reszta zostaje
      }
    }
    writeFileSync(join(dir, 'transcript.txt'), lines.join('\n'), 'utf8');
  }

  exportZip(sessionDir?: string): { zipPath: string } {
    const dir = sessionDir ?? this.lastSessionDir();
    if (!dir) throw new Error('Brak sesji do eksportu');
    const zip = new AdmZip();
    zip.addLocalFolder(dir);
    const zipPath = dir + '.zip';
    zip.writeZip(zipPath);
    return { zipPath };
  }

  private lastSessionDir(): string | null {
    if (!existsSync(this.baseDir)) return null;
    const dirs = readdirSync(this.baseDir)
      .filter((d) => statSync(join(this.baseDir, d)).isDirectory())
      .sort();
    return dirs.length ? join(this.baseDir, dirs[dirs.length - 1]) : null;
  }

  /** Skan przy starcie: sesje bez summary.closedAt -> latanie WAV + flaga recovered. */
  recoverAll(): RecoveredSessionDto[] {
    if (!existsSync(this.baseDir)) return [];
    const recovered: RecoveredSessionDto[] = [];
    for (const name of readdirSync(this.baseDir)) {
      const dir = join(this.baseDir, name);
      const metaPath = join(dir, 'session.json');
      if (!statSync(dir).isDirectory() || !existsSync(metaPath)) continue;
      try {
        const data = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
        const summary = data['summary'] as { closedAt?: string } | undefined;
        if (summary?.closedAt) continue;
        const wavPath = join(dir, 'original.wav');
        if (existsSync(wavPath)) {
          const fd = openSync(wavPath, 'r+');
          patchWavHeader(fd, Math.max(0, statSync(wavPath).size - 44));
          closeSync(fd);
        }
        data['summary'] = {
          closedAt: new Date().toISOString(),
          segmentsTotal: -1,
          notes: 'recovered after crash',
        };
        data['recovered'] = true;
        writeFileSync(metaPath, JSON.stringify(data, null, 2), 'utf8');
        this.writeTranscript(dir);
        recovered.push({ dir, sessionId: name });
      } catch {
        // sesja nieczytelna — zostawiamy nietknieta do recznej inspekcji
      }
    }
    return recovered;
  }
}

function patchWavHeader(fd: number, dataBytes: number): void {
  const { riffSize, dataSize } = wavSizesForFileLength(dataBytes + 44);
  const riff = Buffer.alloc(4);
  riff.writeUInt32LE(riffSize, 0);
  writeSync(fd, riff, 0, 4, 4);
  const dataLen = Buffer.alloc(4);
  dataLen.writeUInt32LE(dataSize, 0);
  writeSync(fd, dataLen, 0, 4, 40);
}
