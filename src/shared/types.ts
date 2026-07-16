// Shared types used across the main, preload, and renderer processes.
// Keep this file dependency-free so it can be imported from any process.

/** xterm.js ITheme — the live terminal palette (Layer A in the handoff). */
export interface XtermTheme {
  foreground: string;
  background: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

/**
 * Window-chrome CSS variables (Layer B). Each key maps to a `--kebab-case`
 * custom property set on :root (see applyChrome in themes.ts).
 */
export interface ChromeTheme {
  chromeBg: string; // --chrome-bg     window body / title bar background
  border: string; // --border          window border
  titlebarFg: string; // --titlebar-fg  title bar text + icons
  accent: string; // --accent          holo accent: buttons, focus rings
  panelBg: string; // --panel-bg        settings panel background
  panelFg: string; // --panel-fg        settings panel text
  scrollbar: string; // --scrollbar     terminal scrollbar thumb
}

export interface FontSettings {
  family: string;
  size: number;
  ligatures: boolean;
}

/** A theme is just data: a complete, named color + font set. */
export interface Theme {
  name: string;
  xterm: XtermTheme;
  chrome: ChromeTheme;
  font: FontSettings;
  /**
   * Command-Center HUD glow intensity (brackets, accent glow, scanlines).
   * Mirrors the Hub's `--hub-glow-strength`. 1 = default, 0 = off. Optional so
   * older custom themes default to 1.
   */
  glowStrength?: number;
}

export interface Settings {
  /** Name of the active theme (a preset name or a custom theme name). */
  activeTheme: string;
  /** User-created themes, persisted across restarts. */
  customThemes: Theme[];
  dingEnabled: boolean;
  /** Only ding for commands that ran longer than this (ms). */
  dingThresholdMs: number;
  /** 'builtin' for the bundled chime, or a `data:` URL for a user-picked file. */
  dingSound: string;
  /** 1.0 = fully opaque. */
  windowOpacity: number;
  /** Font-zoom offset (Ctrl +/-/0), added to the active theme's font size. 0 = no zoom. */
  fontSizeOffset: number;
  /** Optional shell override (e.g. 'pwsh.exe', 'cmd.exe'). Empty = auto-detect. */
  shell?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  activeTheme: 'Lime',
  customThemes: [],
  dingEnabled: true,
  dingThresholdMs: 5000,
  dingSound: 'builtin',
  windowOpacity: 1,
  fontSizeOffset: 0,
  shell: '',
};

export type WindowControlAction = 'minimize' | 'maximize' | 'close';

/**
 * Auto-update state, streamed main -> renderer. The updater downloads in the
 * background; 'ready' means the new version is staged and applies on the next
 * launch (or immediately via restartToUpdate()).
 */
export interface UpdateStatus {
  phase:
    | 'idle' // packaged app, no check has run yet
    | 'checking' // asking update.electronjs.org
    | 'downloading' // update found, downloading in the background
    | 'ready' // downloaded + staged; restart applies it
    | 'uptodate' // check finished: already on the latest version
    | 'error' // check/download failed (offline, GitHub down, …)
    | 'unsupported'; // dev (unpackaged) build — updater inactive
  /** New version ("1.0.8") when known (downloading/ready). */
  version?: string;
  /** Human-readable detail for 'error'. */
  message?: string;
}

/**
 * The narrow, typed surface exposed to the renderer on `window.term`
 * (implemented in preload via contextBridge). This is the entire IPC contract.
 */
export interface TermBridge {
  /** Ask main to spawn a pane's shell at the given initial size. Call once per pane. */
  start(paneId: string, cols: number, rows: number): void;
  /** Send keystrokes / pasted text to a pane's shell. */
  write(paneId: string, data: string): void;
  /** Tell a pane's shell the viewport size changed. */
  resize(paneId: string, cols: number, rows: number): void;
  /** Kill a pane's shell (its tab/pane was closed). */
  killPty(paneId: string): void;
  /** Reap every shell this window owns — call once on (re)load, before spawning panes. */
  resetPtys(): void;
  /** Subscribe to every pane's shell output (cb receives the paneId). Returns unsubscribe. */
  onData(cb: (paneId: string, data: string) => void): () => void;
  /** Subscribe to every pane's shell exit (cb receives the paneId). Returns unsubscribe. */
  onExit(cb: (paneId: string, code: number) => void): () => void;
  /** Base64 PNG data URL for the clipboard image, or null if none. */
  getClipboardImage(): Promise<string | null>;
  /** Save the clipboard image to a temp file and return its path, or null. */
  saveClipboardImageToFile(): Promise<string | null>;
  /** Copy plain text to the OS clipboard (right-click copy). */
  copyText(text: string): void;
  /** Read plain text from the OS clipboard (right-click paste). */
  readClipboardText(): Promise<string>;
  /** Open an http(s) URL in the user's default browser (terminal link click). */
  openExternal(url: string): void;
  /** The installed app's version (package.json version via app.getVersion()). */
  getAppVersion(): Promise<string>;
  /** Current update state; also triggers a fresh check when one isn't running. */
  checkForUpdate(): Promise<UpdateStatus>;
  /** Subscribe to update-state changes. Returns unsubscribe. */
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void;
  /** Quit and install a 'ready' update immediately (no-op otherwise). */
  restartToUpdate(): void;
  loadSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  /** Open a file dialog and return the chosen sound as a data URL, or null. */
  pickSoundFile(): Promise<string | null>;
  windowControl(action: WindowControlAction): void;
  setOpacity(v: number): void;
}
