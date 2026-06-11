import { join } from 'node:path';
import { BrowserWindow, shell } from 'electron';

const preloadPath = join(__dirname, '../preload/index.js');

function rendererUrl(page: 'index' | 'speaker'): { url?: string; file?: string } {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    return { url: `${devUrl}/${page === 'index' ? '' : 'speaker.html'}` };
  }
  return { file: join(__dirname, `../renderer/${page}.html`) };
}

function load(win: BrowserWindow, page: 'index' | 'speaker'): void {
  const target = rendererUrl(page);
  if (target.url) {
    void win.loadURL(target.url);
  } else if (target.file) {
    void win.loadFile(target.file);
  }
}

export function createOperatorWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    title: 'Live Interpreter — pulpit operatora',
    backgroundColor: '#10141a',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  load(win, 'index');
  return win;
}

export function createSpeakerWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 560,
    height: 360,
    title: 'Live Interpreter — wskaznik mowcy',
    backgroundColor: '#10141a',
    alwaysOnTop: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  load(win, 'speaker');
  return win;
}
