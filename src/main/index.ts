import { app, BrowserWindow, session } from 'electron';
import { registerIpc } from './ipc';
import { createOperatorWindow, createSpeakerWindow } from './windows';

let operatorWindow: BrowserWindow | null = null;
let speakerWindow: BrowserWindow | null = null;

function createWindows(): void {
  operatorWindow = createOperatorWindow();
  speakerWindow = createSpeakerWindow();
  operatorWindow.on('closed', () => {
    operatorWindow = null;
    if (speakerWindow && !speakerWindow.isDestroyed()) speakerWindow.close();
  });
  speakerWindow.on('closed', () => {
    speakerWindow = null;
  });
}

app.whenReady().then(() => {
  // Auto-grant dostepu do mikrofonu — aplikacja lokalna, jedyny renderer to nasz kod.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');

  registerIpc(() => speakerWindow);
  createWindows();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindows();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
