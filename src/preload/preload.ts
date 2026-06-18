import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC } from '../shared/channels';
import type { Settings, TermBridge, WindowControlAction } from '../shared/types';

// The single, narrow surface the renderer can touch. Everything privileged
// (node-pty, clipboard, fs, dialogs) lives in main; this only forwards.
const api: TermBridge = {
  start(cols, rows) {
    ipcRenderer.send(IPC.PTY_START, { cols, rows });
  },
  write(data) {
    ipcRenderer.send(IPC.PTY_WRITE, data);
  },
  resize(cols, rows) {
    ipcRenderer.send(IPC.PTY_RESIZE, { cols, rows });
  },
  onData(cb) {
    const handler = (_e: IpcRendererEvent, data: string) => cb(data);
    ipcRenderer.on(IPC.PTY_DATA, handler);
    return () => ipcRenderer.removeListener(IPC.PTY_DATA, handler);
  },
  onExit(cb) {
    const handler = (_e: IpcRendererEvent, code: number) => cb(code);
    ipcRenderer.on(IPC.PTY_EXIT, handler);
    return () => ipcRenderer.removeListener(IPC.PTY_EXIT, handler);
  },
  getClipboardImage(): Promise<string | null> {
    return ipcRenderer.invoke(IPC.CLIPBOARD_IMAGE);
  },
  saveClipboardImageToFile(): Promise<string | null> {
    return ipcRenderer.invoke(IPC.CLIPBOARD_IMAGE_FILE);
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
