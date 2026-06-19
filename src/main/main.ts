import { app, BrowserWindow, ipcMain, dialog, session, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import started from 'electron-squirrel-startup';
import { IPC } from '../shared/channels';
import type { Settings, WindowControlAction } from '../shared/types';
import {
  spawnPty,
  writeToPty,
  resizePty,
  killPty,
  killPtysForContents,
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

// Single-instance guard: a second launch focuses the existing window instead of
// spawning another process. Multiple instances shared one user-data dir and
// fought over the disk/GPU cache, which could stall window creation and leave
// failed launches piling up as invisible, un-closable zombie processes.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

const clampOpacity = (v: number): number =>
  Number.isFinite(v) ? Math.min(1, Math.max(0.3, v)) : 1;

// Lightweight startup diagnostics to a temp file — a packaged GUI app has no
// attached console, so this is the only durable record of window/renderer
// lifecycle if a launch ever gets stuck again.
function diag(msg: string): void {
  try {
    appendFileSync(path.join(app.getPath('temp'), 'conduit-diag.log'), `${Date.now()} ${msg}\n`);
  } catch {
    /* never let logging break startup */
  }
}

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

  // Reveal the window once content is ready. `ready-to-show` is the ideal signal
  // (no white flash) but it can fail to fire in some environments (GPU/cache
  // init hiccups). Without a fallback, a missed `ready-to-show` leaves an
  // invisible, un-closable window — so also reveal on load-finish and a short
  // timeout. revealWindow is idempotent (no-ops once the window is visible).
  const revealWindow = (via: string) => {
    if (win.isDestroyed() || win.isVisible()) return;
    diag(`show via ${via}`);
    win.show();
    win.focus();
  };
  win.once('ready-to-show', () => revealWindow('ready-to-show'));
  setTimeout(() => revealWindow('timeout'), 3500);

  win.webContents.on('render-process-gone', (_e, details) => {
    diag(`render-process-gone: ${details.reason}`);
    console.error('[conduit] renderer process gone:', details.reason);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    diag(`did-fail-load: ${code} ${desc} ${url}`);
    console.error('[conduit] did-fail-load:', code, desc, url);
  });

  win.webContents.on('did-finish-load', () => {
    diag('did-finish-load');
    // Lock the renderer to 100% zoom so ONLY Conduit's own font zoom changes the
    // text size (Ctrl +/- and Ctrl+wheel would otherwise drive Chromium's page
    // zoom, compounding with the font zoom and shrinking the whole UI).
    win.webContents.setZoomFactor(1);
    void win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => undefined);
    revealWindow('did-finish-load');
  });
  diag('createWindow: listeners attached, loading content');

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  win.on('closed', () => {
    killPtysForContents(wcId);
    if (mainWindow === win) mainWindow = null;
  });
}

function registerIpc(): void {
  // ---- pty lifecycle (the standalone host's PtyApi implementation) ----
  ipcMain.on(IPC.PTY_START, (e, m: { paneId: string; cols: number; rows: number }) => {
    const settings = loadSettings();
    spawnPty(m.paneId, e.sender, m?.cols, m?.rows, settings.shell);
  });
  ipcMain.on(IPC.PTY_WRITE, (_e, m: { paneId: string; data: string }) =>
    writeToPty(m.paneId, m.data),
  );
  ipcMain.on(IPC.PTY_RESIZE, (_e, m: { paneId: string; cols: number; rows: number }) =>
    resizePty(m.paneId, m.cols, m.rows),
  );
  ipcMain.on(IPC.PTY_KILL, (_e, m: { paneId: string }) => killPty(m.paneId));
  // A (re)loaded renderer reaps the shells it orphaned, before spawning new panes.
  ipcMain.on(IPC.PTY_RESET, (e) => killPtysForContents(e.sender.id));

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

// A second launch (e.g. clicking the shortcut again) focuses the live window
// rather than starting a competing instance.
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
});

// Only the primary instance boots the UI. A non-primary instance already called
// app.quit() above; its launch is handled by the 'second-instance' listener
// (which focuses this window), so it must never reach createWindow().
if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
    diag('app ready');
    // Drop Electron's default application menu. It bound Ctrl +/-/0 to page zoom
    // (which fought Conduit's font zoom) and Ctrl+R to "reload" (which hijacked
    // the shell's reverse-search). The app has fully custom chrome and needs none.
    Menu.setApplicationMenu(null);
    installCsp();
    registerIpc();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
