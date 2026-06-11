import { app, BrowserWindow, session } from 'electron';
import { registerIpc } from './ipc';
import { createOperatorWindow, createSpeakerWindow } from './windows';

let operatorWindow: BrowserWindow | null = null;
let speakerWindow: BrowserWindow | null = null;

function spawnSpeakerWindow(): void {
  speakerWindow = createSpeakerWindow();
  speakerWindow.on('closed', () => {
    speakerWindow = null;
  });
}

function createWindows(): void {
  // Wskaznik mowcy PIERWSZY, pulpit operatora OSTATNI — operator dostaje fokus na starcie.
  spawnSpeakerWindow();
  operatorWindow = createOperatorWindow();
  operatorWindow.on('closed', () => {
    operatorWindow = null;
    if (speakerWindow && !speakerWindow.isDestroyed()) speakerWindow.close();
  });
}

/** Pokaz/ukryj wskaznik mowcy; odtwarza okno gdy zostalo zamkniete. Zwraca nowa widocznosc. */
function toggleSpeakerWindow(): boolean {
  if (!speakerWindow || speakerWindow.isDestroyed()) {
    spawnSpeakerWindow();
    return true;
  }
  if (speakerWindow.isVisible()) {
    speakerWindow.hide();
    return false;
  }
  // showInactive — nie kradnij fokusu operatorowi.
  speakerWindow.showInactive();
  return true;
}

app.whenReady().then(() => {
  // Auto-grant dostepu do mikrofonu — aplikacja lokalna, jedyny renderer to nasz kod.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');

  registerIpc({
    getSpeakerWindow: () => speakerWindow,
    toggleSpeakerWindow,
  });
  createWindows();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindows();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
