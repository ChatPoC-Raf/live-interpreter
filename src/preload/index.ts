import { contextBridge, ipcRenderer } from 'electron';
import type {
  LiveApi,
  ProfileDto,
  SecretsDto,
  SessionMetaDto,
  SessionSummaryDto,
  SettingsDto,
  SpeakerStatusDto,
} from '../shared/ipc';
import { IPC } from '../shared/ipc';

const api: LiveApi = {
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  saveSettings: (patch: Partial<SettingsDto>) => ipcRenderer.invoke(IPC.settingsSave, patch),
  getSecretsPresence: () => ipcRenderer.invoke(IPC.secretsPresence),
  saveSecrets: (secrets: Partial<SecretsDto>) => ipcRenderer.invoke(IPC.secretsSave, secrets),
  getSecrets: () => ipcRenderer.invoke(IPC.secretsGet),

  listProfiles: () => ipcRenderer.invoke(IPC.profilesList),
  saveProfile: (profile: ProfileDto) => ipcRenderer.invoke(IPC.profilesSave, profile),
  deleteProfile: (id: string) => ipcRenderer.invoke(IPC.profilesDelete, id),

  artifactsStart: (meta: SessionMetaDto) => ipcRenderer.invoke(IPC.artifactsStart, meta),
  artifactsAppendEvent: (event: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC.artifactsAppendEvent, event),
  artifactsAppendPcm: (chunk: ArrayBuffer) => ipcRenderer.invoke(IPC.artifactsAppendPcm, chunk),
  artifactsSaveTts: (segmentNo: number, pcm24k: ArrayBuffer) =>
    ipcRenderer.invoke(IPC.artifactsSaveTts, segmentNo, pcm24k),
  artifactsFinalize: (summary: SessionSummaryDto) =>
    ipcRenderer.invoke(IPC.artifactsFinalize, summary),
  artifactsExport: (sessionDir?: string) => ipcRenderer.invoke(IPC.artifactsExport, sessionDir),
  recoverSessions: () => ipcRenderer.invoke(IPC.artifactsRecover),
  openSessionsFolder: () => ipcRenderer.invoke(IPC.artifactsOpenFolder),

  setSpeakerStatus: (status: SpeakerStatusDto) => ipcRenderer.invoke(IPC.speakerSet, status),
  onSpeakerStatus: (cb: (status: SpeakerStatusDto) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, status: SpeakerStatusDto): void => cb(status);
    ipcRenderer.on(IPC.speakerStatus, listener);
    return () => ipcRenderer.removeListener(IPC.speakerStatus, listener);
  },
};

contextBridge.exposeInMainWorld('live', api);
