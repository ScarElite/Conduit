// Canonical IPC channel names. Imported by both main and preload so the two
// sides can never drift out of sync.

export const IPC = {
  PTY_START: 'pty:start', // renderer -> main: spawn shell at initial size
  PTY_DATA: 'pty:data', // main -> renderer: shell output
  PTY_EXIT: 'pty:exit', // main -> renderer: shell exited
  PTY_WRITE: 'pty:write', // renderer -> main: keystrokes / pasted text
  PTY_RESIZE: 'pty:resize', // renderer -> main: viewport resized
  CLIPBOARD_IMAGE: 'clipboard:image', // invoke -> data URL | null
  SETTINGS_LOAD: 'settings:load', // invoke -> Settings
  SETTINGS_SAVE: 'settings:save', // invoke(Settings) -> void
  SHELL_INTEGRATION_INSTALL: 'shell:install-integration', // invoke -> ShellIntegrationResult
  PICK_SOUND: 'sound:pick', // invoke -> data URL | null
  WINDOW_CONTROL: 'window:control', // renderer -> main: minimize/maximize/close
  WINDOW_SET_OPACITY: 'window:set-opacity', // renderer -> main: number
  APP_RELAUNCH: 'app:relaunch', // renderer -> main: relaunch the app
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
