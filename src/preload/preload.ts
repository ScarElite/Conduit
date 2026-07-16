import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC } from '../shared/channels';
import type { Settings, TermBridge, UpdateStatus, WindowControlAction } from '../shared/types';

// The single, narrow surface the renderer can touch. Everything privileged
// (node-pty, clipboard, fs, dialogs) lives in main; this only forwards.
const api: TermBridge = {
  start(paneId, cols, rows) {
    ipcRenderer.send(IPC.PTY_START, { paneId, cols, rows });
  },
  write(paneId, data) {
    ipcRenderer.send(IPC.PTY_WRITE, { paneId, data });
  },
  resize(paneId, cols, rows) {
    ipcRenderer.send(IPC.PTY_RESIZE, { paneId, cols, rows });
  },
  killPty(paneId) {
    ipcRenderer.send(IPC.PTY_KILL, { paneId });
  },
  resetPtys() {
    ipcRenderer.send(IPC.PTY_RESET);
  },
  onData(cb) {
    const handler = (_e: IpcRendererEvent, m: { paneId: string; data: string }) =>
      cb(m.paneId, m.data);
    ipcRenderer.on(IPC.PTY_DATA, handler);
    return () => ipcRenderer.removeListener(IPC.PTY_DATA, handler);
  },
  onExit(cb) {
    const handler = (_e: IpcRendererEvent, m: { paneId: string; code: number }) =>
      cb(m.paneId, m.code);
    ipcRenderer.on(IPC.PTY_EXIT, handler);
    return () => ipcRenderer.removeListener(IPC.PTY_EXIT, handler);
  },
  getClipboardImage(): Promise<string | null> {
    return ipcRenderer.invoke(IPC.CLIPBOARD_IMAGE);
  },
  saveClipboardImageToFile(): Promise<string | null> {
    return ipcRenderer.invoke(IPC.CLIPBOARD_IMAGE_FILE);
  },
  copyText(text: string) {
    ipcRenderer.send(IPC.CLIPBOARD_WRITE_TEXT, text);
  },
  readClipboardText(): Promise<string> {
    return ipcRenderer.invoke(IPC.CLIPBOARD_READ_TEXT);
  },
  openExternal(url: string) {
    ipcRenderer.send(IPC.OPEN_EXTERNAL, url);
  },
  getAppVersion(): Promise<string> {
    return ipcRenderer.invoke(IPC.APP_VERSION);
  },
  checkForUpdate(): Promise<UpdateStatus> {
    return ipcRenderer.invoke(IPC.UPDATE_CHECK);
  },
  onUpdateStatus(cb) {
    const handler = (_e: IpcRendererEvent, status: UpdateStatus) => cb(status);
    ipcRenderer.on(IPC.UPDATE_STATUS, handler);
    return () => ipcRenderer.removeListener(IPC.UPDATE_STATUS, handler);
  },
  restartToUpdate() {
    ipcRenderer.send(IPC.UPDATE_RESTART);
  },
  loadSettings(): Promise<Settings> {
    return ipcRenderer.invoke(IPC.SETTINGS_LOAD);
  },
  saveSettings(s: Settings): Promise<void> {
    return ipcRenderer.invoke(IPC.SETTINGS_SAVE, s);
  },
  pickSoundFile(): Promise<string | null> {
    return ipcRenderer.invoke(IPC.PICK_SOUND);
  },
  windowControl(action: WindowControlAction) {
    ipcRenderer.send(IPC.WINDOW_CONTROL, action);
  },
  setOpacity(v: number) {
    ipcRenderer.send(IPC.WINDOW_SET_OPACITY, v);
  },
};

contextBridge.exposeInMainWorld('term', api);
