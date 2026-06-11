// Ustawienia + sekrety (klucze API). Sekrety szyfrowane przez Electron safeStorage —
// nigdy plaintext na dysku. Plik: userData/settings.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { safeStorage } from 'electron';
import type { SecretsDto, SecretsPresenceDto, SettingsDto } from '../shared/ipc';

export const DEFAULT_SETTINGS: SettingsDto = {
  llmProvider: 'gemini',
  targetLang: 'pl',
  vadRedemptionMs: 800,
  vadMinSpeechMs: 400,
  playbackTailMs: 400,
  bargeInThreshold: 0.07,
  soundcheckPassed: false,
  inputDeviceId: null,
  inputDeviceLabel: null,
  inputDeviceGroupId: null,
  outputDeviceId: null,
  outputDeviceLabel: null,
  outputDeviceGroupId: null,
  inputGain: 1,
  outputGain: 1,
  activeProfileId: null,
};

interface StoreFile {
  settings: SettingsDto;
  /** Zaszyfrowane bufory w base64. */
  secrets: { elevenKey?: string; llmKey?: string };
}

export class SettingsStore {
  private readonly filePath: string;
  private data: StoreFile;

  constructor(userDataDir: string) {
    this.filePath = join(userDataDir, 'settings.json');
    this.data = this.load();
  }

  private load(): StoreFile {
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<StoreFile>;
      return {
        settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
        secrets: raw.secrets ?? {},
      };
    } catch {
      return { settings: { ...DEFAULT_SETTINGS }, secrets: {} };
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  getSettings(): SettingsDto {
    return { ...this.data.settings };
  }

  saveSettings(patch: Partial<SettingsDto>): SettingsDto {
    this.data.settings = { ...this.data.settings, ...patch };
    this.persist();
    return this.getSettings();
  }

  private encrypt(value: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage niedostepne — nie mozna bezpiecznie zapisac klucza');
    }
    return safeStorage.encryptString(value).toString('base64');
  }

  private decrypt(value: string | undefined): string | null {
    if (!value) return null;
    try {
      return safeStorage.decryptString(Buffer.from(value, 'base64'));
    } catch {
      return null;
    }
  }

  saveSecrets(secrets: Partial<SecretsDto>): SecretsPresenceDto {
    if (secrets.elevenKey !== undefined) {
      this.data.secrets.elevenKey = secrets.elevenKey
        ? this.encrypt(secrets.elevenKey)
        : undefined;
    }
    if (secrets.llmKey !== undefined) {
      this.data.secrets.llmKey = secrets.llmKey ? this.encrypt(secrets.llmKey) : undefined;
    }
    this.persist();
    return this.getPresence();
  }

  getSecrets(): SecretsDto {
    return {
      elevenKey: this.decrypt(this.data.secrets.elevenKey),
      llmKey: this.decrypt(this.data.secrets.llmKey),
    };
  }

  getPresence(): SecretsPresenceDto {
    return {
      hasElevenKey: Boolean(this.data.secrets.elevenKey),
      hasLlmKey: Boolean(this.data.secrets.llmKey),
    };
  }
}
