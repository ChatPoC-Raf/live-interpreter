// Rejestracja handlerow IPC: ustawienia, sekrety, profile, artefakty, relay statusu mowcy.
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import type {
  ProfileDto,
  SecretsDto,
  SessionMetaDto,
  SessionSummaryDto,
  SettingsDto,
  SpeakerStatusDto,
} from '../shared/ipc';
import { IPC } from '../shared/ipc';
import { ArtifactsManager } from './artifacts/artifactsCore';
import { ProfilesStore } from './profilesStore';
import { SettingsStore } from './settingsStore';

export interface IpcContext {
  artifacts: ArtifactsManager;
}

export function registerIpc(getSpeakerWindow: () => BrowserWindow | null): IpcContext {
  const userData = app.getPath('userData');
  const settings = new SettingsStore(userData);
  const profiles = new ProfilesStore(userData);
  const artifacts = new ArtifactsManager(join(userData, 'sessions'));

  ipcMain.handle(IPC.settingsGet, () => settings.getSettings());
  ipcMain.handle(IPC.settingsSave, (_e, patch: Partial<SettingsDto>) =>
    settings.saveSettings(patch),
  );
  ipcMain.handle(IPC.secretsPresence, () => settings.getPresence());
  ipcMain.handle(IPC.secretsSave, (_e, secrets: Partial<SecretsDto>) =>
    settings.saveSecrets(secrets),
  );
  ipcMain.handle(IPC.secretsGet, () => settings.getSecrets());

  ipcMain.handle(IPC.profilesList, () => profiles.list());
  ipcMain.handle(IPC.profilesSave, (_e, profile: ProfileDto) => profiles.save(profile));
  ipcMain.handle(IPC.profilesDelete, (_e, id: string) => profiles.delete(id));

  ipcMain.handle(IPC.artifactsStart, (_e, meta: SessionMetaDto) => artifacts.start(meta));
  ipcMain.handle(IPC.artifactsAppendEvent, (_e, event: Record<string, unknown>) =>
    artifacts.appendEvent(event),
  );
  ipcMain.handle(IPC.artifactsAppendPcm, (_e, chunk: ArrayBuffer) =>
    artifacts.appendPcm(Buffer.from(chunk)),
  );
  ipcMain.handle(IPC.artifactsSaveTts, (_e, segmentNo: number, pcm: ArrayBuffer) =>
    artifacts.saveTts(segmentNo, Buffer.from(pcm)),
  );
  ipcMain.handle(IPC.artifactsFinalize, (_e, summary: SessionSummaryDto) =>
    artifacts.finalize(summary),
  );
  ipcMain.handle(IPC.artifactsExport, (_e, sessionDir?: string) => artifacts.exportZip(sessionDir));
  ipcMain.handle(IPC.artifactsRecover, () => artifacts.recoverAll());
  ipcMain.handle(IPC.artifactsOpenFolder, () => {
    void shell.openPath(join(userData, 'sessions'));
  });

  ipcMain.handle(IPC.speakerSet, (_e, status: SpeakerStatusDto) => {
    const win = getSpeakerWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.speakerStatus, status);
    }
  });

  return { artifacts };
}
