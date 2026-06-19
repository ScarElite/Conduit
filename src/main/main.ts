import { app, BrowserWindow, ipcMain, dialog, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import started from 'electron-squirrel-startup';
import { IPC } from '../shared/channels';
import type { Settings, WindowControlAction } from '../shared/types';
import {
  spawnPtyForContents,
  writeToPty,
  resizePty,
  killPtyForContents,
} from './pty';
import {
  getClipboardImage,
  saveClipboardImageToTemp,
  writeClipboardText,
  readClipboardText,
} from './clipboard';
import { loadSettings, saveSettings } from './settings';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

const clampOpacity = (v: number): number =>
  Number.isFinite(v) ? Math.min(1, Math.max(0.3, v)) : 1;

// Set the Content-Security-Policy via response headers so production can be
// strict while dev allows Vite's HMR socket + inline react-refresh preamble.
function installCsp(): void {
  const dev = !app.isPackaged;
  const csp = [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "font-src 'self' data:",
    dev ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
  ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
}

function createWindow(): void {
  const settings = loadSettings();

  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 480,
    minHeight: 300,
    frame: false, // fully custom, themeable chrome (see TitleBar)
    backgroundColor: '#0a0e0a',
    show: false,
    icon: path.join(app.getAppPath(), 'assets', 'icons', 'conduit.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, // required: isolate renderer from preload/Node
      nodeIntegration: false, // required: renderer gets no raw Node
      sandbox: false, // preload needs Node built-ins; main owns all privileged work
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required', // let the completion ding play
    },
  });
  mainWindow = win;
  // Capture the id now — after 'closed', win.webContents is destroyed and reading
  // it throws "Object has been destroyed".
  const wcId = win.webContents.id;

  win.setOpacity(clampOpacity(settings.windowOpacity ?? 1));
  win.once('ready-to-show', () => win.show());

  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[conduit] renderer process gone:', details.reason);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[conduit] did-fail-load:', code, desc, url);
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  win.on('closed', () => {
    killPtyForContents(wcId);
    if (mainWindow === win) mainWindow = null;
  });
}

function registerIpc(): void {
  // ---- pty lifecycle (the standalone host's PtyApi implementation) ----
  ipcMain.on(IPC.PTY_START, (e, size: { cols: number; rows: number }) => {
    const settings = loadSettings();
    spawnPtyForContents(e.sender, size?.cols, size?.rows, settings.shell);
  });
  ipcMain.on(IPC.PTY_WRITE, (e, data: string) => writeToPty(e.sender.id, data));
  ipcMain.on(IPC.PTY_RESIZE, (e, size: { cols: number; rows: number }) =>
    resizePty(e.sender.id, size.cols, size.rows),
  );

  // ---- clipboard image: data URL for inline overlay, temp file for feeding a TUI ----
  ipcMain.handle(IPC.CLIPBOARD_IMAGE, () => getClipboardImage());
  ipcMain.handle(IPC.CLIPBOARD_IMAGE_FILE, () => saveClipboardImageToTemp());

  // ---- clipboard text: right-click copy/paste ----
  ipcMain.on(IPC.CLIPBOARD_WRITE_TEXT, (_e, text: string) => writeClipboardText(text));
  ipcMain.handle(IPC.CLIPBOARD_READ_TEXT, () => readClipboardText());

  // ---- settings persistence ----
  ipcMain.handle(IPC.SETTINGS_LOAD, () => loadSettings());
  ipcMain.handle(IPC.SETTINGS_SAVE, (_e, s: Settings) => {
    saveSettings(s);
  });

  // ---- pick a custom ding sound -> data URL ----
  ipcMain.handle(IPC.PICK_SOUND, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      title: 'Choose a completion sound',
      properties: ['openFile' as const],
      filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac', 'm4a'] }],
    };
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return null;
    const file = result.filePaths[0];
    const buf = await fs.readFile(file);
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime =
      ext === 'mp3' ? 'audio/mpeg'
        : ext === 'ogg' ? 'audio/ogg'
          : ext === 'flac' ? 'audio/flac'
            : ext === 'm4a' ? 'audio/mp4'
              : 'audio/wav';
    return `data:${mime};base64,${buf.toString('base64')}`;
  });

  // ---- window controls (frameless chrome) ----
  ipcMain.on(IPC.WINDOW_CONTROL, (e, action: WindowControlAction) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'close') win.close();
  });
  ipcMain.on(IPC.WINDOW_SET_OPACITY, (e, v: number) => {
    BrowserWindow.fromWebContents(e.sender)?.setOpacity(clampOpacity(v));
  });
}

// Harden against the renderer being navigated away or opening new windows.
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (url !== contents.getURL()) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (url !== contents.getURL()) event.preventDefault();
  });
});

app.whenReady().then(() => {
  installCsp();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
