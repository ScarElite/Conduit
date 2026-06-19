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
  shell: '',
};

export type WindowControlAction = 'minimize' | 'maximize' | 'close';

/**
 * The narrow, typed surface exposed to the renderer on `window.term`
 * (implemented in preload via contextBridge). This is the entire IPC contract.
 */
export interface TermBridge {
  /** Ask main to spawn the shell at the given initial size. Call once, after xterm is ready. */
  start(cols: number, rows: number): void;
  /** Send keystrokes / pasted text to the shell. */
  write(data: string): void;
  /** Tell the shell the viewport size changed. */
  resize(cols: number, rows: number): void;
  /** Subscribe to shell output. Returns an unsubscribe function. */
  onData(cb: (data: string) => void): () => void;
  /** Subscribe to shell exit. Returns an unsubscribe function. */
  onExit(cb: (code: number) => void): () => void;
  /** Base64 PNG data URL for the clipboard image, or null if none. */
  getClipboardImage(): Promise<string | null>;
  /** Save the clipboard image to a temp file and return its path, or null. */
  saveClipboardImageToFile(): Promise<string | null>;
  loadSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  /** Open a file dialog and return the chosen sound as a data URL, or null. */
  pickSoundFile(): Promise<string | null>;
  windowControl(action: WindowControlAction): void;
  setOpacity(v: number): void;
}
