// Canonical IPC channel names. Imported by both main and preload so the two
// sides can never drift out of sync.

export const IPC = {
  // All pty messages carry a { paneId, ... } payload so one window can run many
  // independent shells (one per tab/pane).
  PTY_START: 'pty:start', // renderer -> main: spawn shell { paneId, cols, rows }
  PTY_DATA: 'pty:data', // main -> renderer: shell output { paneId, data }
  PTY_EXIT: 'pty:exit', // main -> renderer: shell exited { paneId, code }
  PTY_WRITE: 'pty:write', // renderer -> main: keystrokes/pasted text { paneId, data }
  PTY_RESIZE: 'pty:resize', // renderer -> main: viewport resized { paneId, cols, rows }
  PTY_KILL: 'pty:kill', // renderer -> main: kill a shell { paneId } (tab closed)
  PTY_RESET: 'pty:reset', // renderer -> main: reap all this window's shells (on (re)load)
  CLIPBOARD_IMAGE: 'clipboard:image', // invoke -> data URL | null
  CLIPBOARD_IMAGE_FILE: 'clipboard:image-file', // invoke -> temp file path | null
  CLIPBOARD_WRITE_TEXT: 'clipboard:write-text', // renderer -> main: copy text to clipboard
  CLIPBOARD_READ_TEXT: 'clipboard:read-text', // invoke -> clipboard text (string)
  SETTINGS_LOAD: 'settings:load', // invoke -> Settings
  SETTINGS_SAVE: 'settings:save', // invoke(Settings) -> void
  PICK_SOUND: 'sound:pick', // invoke -> data URL | null
  WINDOW_CONTROL: 'window:control', // renderer -> main: minimize/maximize/close
  WINDOW_SET_OPACITY: 'window:set-opacity', // renderer -> main: number
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
