// Kontrakt IPC miedzy procesami: main <-> renderer (operator + speaker).
// Tylko typy — zero implementacji.

export type LlmProviderId = 'gemini' | 'anthropic';

export interface SettingsDto {
  llmProvider: LlmProviderId;
  /** Kod jezyka docelowego, np. 'pl', 'en', 'de'. */
  targetLang: string;
  /** Czas ciszy konczacy ture mowcy (ms). */
  vadRedemptionMs: number;
  /** Minimalna dlugosc mowy, ponizej ktorej segment jest odfiltrowany (ms). */
  vadMinSpeechMs: number;
  /** Ogon po playbacku zanim mikrofon znow otwarty (ms). */
  playbackTailMs: number;
  /** Prog RMS barge-in (0..1) — kalibrowany w soundchecku. */
  bargeInThreshold: number;
  /** Czy soundcheck zostal zaliczony w tej konfiguracji. */
  soundcheckPassed: boolean;
  /** Id zapisanych urzadzen audio (pin + fallback po label/groupId). */
  inputDeviceId: string | null;
  inputDeviceLabel: string | null;
  inputDeviceGroupId: string | null;
  outputDeviceId: string | null;
  outputDeviceLabel: string | null;
  outputDeviceGroupId: string | null;
  inputGain: number;
  outputGain: number;
  /** Aktywny profil mowcy. */
  activeProfileId: string | null;
}

export interface SecretsPresenceDto {
  hasElevenKey: boolean;
  hasLlmKey: boolean;
}

export interface SecretsDto {
  elevenKey: string | null;
  llmKey: string | null;
}

export interface ProfileDto {
  id: string;
  name: string;
  voiceId: string;
  consentNote: string;
  createdAt: string;
}

export type SpeakerMode =
  | 'IDLE'
  | 'MOW'
  | 'CZEKAJ_TLUMACZE'
  | 'CZEKAJ_ODTWARZAM'
  | 'PAUZA'
  | 'AWARIA';

export interface SpeakerStatusDto {
  mode: SpeakerMode;
  detail?: string;
}

export interface SessionMetaDto {
  sessionId: string;
  startedAt: string;
  targetLang: string;
  profileName: string;
  voiceId: string;
}

export interface SessionSummaryDto {
  closedAt: string;
  segmentsTotal: number;
  notes?: string;
}

export interface ExportResultDto {
  zipPath: string;
}

export interface RecoveredSessionDto {
  dir: string;
  sessionId: string;
}

/** API udostepniane rendererowi przez preload (window.live). */
export interface LiveApi {
  getSettings(): Promise<SettingsDto>;
  saveSettings(patch: Partial<SettingsDto>): Promise<SettingsDto>;
  getSecretsPresence(): Promise<SecretsPresenceDto>;
  saveSecrets(secrets: Partial<SecretsDto>): Promise<SecretsPresenceDto>;
  getSecrets(): Promise<SecretsDto>;

  listProfiles(): Promise<ProfileDto[]>;
  saveProfile(profile: ProfileDto): Promise<ProfileDto[]>;
  deleteProfile(id: string): Promise<ProfileDto[]>;

  artifactsStart(meta: SessionMetaDto): Promise<{ dir: string }>;
  artifactsAppendEvent(event: Record<string, unknown>): Promise<void>;
  artifactsAppendPcm(chunk: ArrayBuffer): Promise<void>;
  artifactsSaveTts(segmentNo: number, pcm24k: ArrayBuffer): Promise<void>;
  artifactsFinalize(summary: SessionSummaryDto): Promise<void>;
  artifactsExport(sessionDir?: string): Promise<ExportResultDto>;
  recoverSessions(): Promise<RecoveredSessionDto[]>;
  openSessionsFolder(): Promise<void>;

  setSpeakerStatus(status: SpeakerStatusDto): Promise<void>;
  onSpeakerStatus(cb: (status: SpeakerStatusDto) => void): () => void;
}

export const IPC = {
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  secretsPresence: 'secrets:presence',
  secretsSave: 'secrets:save',
  secretsGet: 'secrets:get',
  profilesList: 'profiles:list',
  profilesSave: 'profiles:save',
  profilesDelete: 'profiles:delete',
  artifactsStart: 'artifacts:start',
  artifactsAppendEvent: 'artifacts:append-event',
  artifactsAppendPcm: 'artifacts:append-pcm',
  artifactsSaveTts: 'artifacts:save-tts',
  artifactsFinalize: 'artifacts:finalize',
  artifactsExport: 'artifacts:export',
  artifactsRecover: 'artifacts:recover',
  artifactsOpenFolder: 'artifacts:open-folder',
  speakerSet: 'speaker:set',
  speakerStatus: 'speaker:status',
} as const;
