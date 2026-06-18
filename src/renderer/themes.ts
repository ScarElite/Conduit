import type { ChromeTheme, Theme } from '../shared/types';

// A pleasant, ligature-capable mono stack. Cascadia Code ships with modern
// Windows; the rest are graceful fallbacks.
const MONO =
  '"Cascadia Code", "JetBrains Mono", "Fira Code", Consolas, ui-monospace, monospace';

/**
 * Preset themes. "Vlime" (lime-green on near-black, restrained cyberpunk) is the
 * flagship default; the rest give range. Each is a complete, self-contained
 * color + font set — a theme is just data.
 */
export const PRESETS: Theme[] = [
  {
    name: 'Vlime',
    font: { family: MONO, size: 14, ligatures: false },
    xterm: {
      foreground: '#a8e05f',
      background: '#0a0f0a',
      cursor: '#caff70',
      cursorAccent: '#0a0f0a',
      selectionBackground: '#21401f',
      black: '#11160f',
      red: '#ff5c7a',
      green: '#a3e635',
      yellow: '#d4e157',
      blue: '#4fc3f7',
      magenta: '#c792ea',
      cyan: '#56e0c0',
      white: '#cfe8b4',
      brightBlack: '#3a4a32',
      brightRed: '#ff7a93',
      brightGreen: '#bdf64f',
      brightYellow: '#e6f06a',
      brightBlue: '#73d4ff',
      brightMagenta: '#dca8ff',
      brightCyan: '#7af0d6',
      brightWhite: '#eaffd6',
    },
    chrome: {
      chromeBg: '#0a0f0a',
      border: '#2b6b1f',
      titlebarFg: '#a8e05f',
      accent: '#9bff3b',
      panelBg: '#0d140d',
      panelFg: '#c5e8b7',
      scrollbar: '#2b6b1f',
    },
  },
  {
    name: 'Holo',
    font: { family: MONO, size: 14, ligatures: false },
    xterm: {
      foreground: '#c9d1d9',
      background: '#0a0e14',
      cursor: '#58a6ff',
      cursorAccent: '#0a0e14',
      selectionBackground: '#1f3a5f',
      black: '#0a0e14',
      red: '#ff7b72',
      green: '#3fb950',
      yellow: '#d29922',
      blue: '#58a6ff',
      magenta: '#bc8cff',
      cyan: '#39c5cf',
      white: '#b1bac4',
      brightBlack: '#484f58',
      brightRed: '#ffa198',
      brightGreen: '#56d364',
      brightYellow: '#e3b341',
      brightBlue: '#79c0ff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#56d4dd',
      brightWhite: '#f0f6fc',
    },
    chrome: {
      chromeBg: '#0a0e14',
      border: '#1f6feb',
      titlebarFg: '#c9d1d9',
      accent: '#58a6ff',
      panelBg: '#0d1117',
      panelFg: '#c9d1d9',
      scrollbar: '#1f6feb',
    },
  },
  {
    name: 'Green Classic',
    font: { family: MONO, size: 14, ligatures: false },
    xterm: {
      foreground: '#00ff66',
      background: '#000000',
      cursor: '#00ff66',
      cursorAccent: '#000000',
      selectionBackground: '#003b1f',
      black: '#000000',
      red: '#ff3b3b',
      green: '#00ff66',
      yellow: '#d7ff00',
      blue: '#00b3ff',
      magenta: '#ff5fd2',
      cyan: '#00ffd0',
      white: '#c0ffc0',
      brightBlack: '#1f3b27',
      brightRed: '#ff6b6b',
      brightGreen: '#5bff9b',
      brightYellow: '#eaff5b',
      brightBlue: '#5bd0ff',
      brightMagenta: '#ff9be8',
      brightCyan: '#5bffe6',
      brightWhite: '#eaffea',
    },
    chrome: {
      chromeBg: '#000000',
      border: '#00ff66',
      titlebarFg: '#00ff66',
      accent: '#00ff66',
      panelBg: '#001a0d',
      panelFg: '#9dffb0',
      scrollbar: '#00aa44',
    },
  },
  {
    name: 'High Contrast Light',
    font: { family: MONO, size: 14, ligatures: false },
    xterm: {
      foreground: '#1a1a1a',
      background: '#ffffff',
      cursor: '#1a1a1a',
      cursorAccent: '#ffffff',
      selectionBackground: '#cfe3ff',
      black: '#1a1a1a',
      red: '#c5221f',
      green: '#197a3e',
      yellow: '#a8740a',
      blue: '#1a56db',
      magenta: '#9a23a8',
      cyan: '#0c7a86',
      white: '#5f6368',
      brightBlack: '#3c4043',
      brightRed: '#e04a45',
      brightGreen: '#1e9e50',
      brightYellow: '#c8901a',
      brightBlue: '#2b6cf5',
      brightMagenta: '#b836c7',
      brightCyan: '#138a98',
      brightWhite: '#202124',
    },
    chrome: {
      chromeBg: '#f5f5f5',
      border: '#1a56db',
      titlebarFg: '#1a1a1a',
      accent: '#1a56db',
      panelBg: '#ffffff',
      panelFg: '#1a1a1a',
      scrollbar: '#9aa0a6',
    },
  },
  {
    name: 'Parchment',
    font: { family: MONO, size: 14, ligatures: false },
    xterm: {
      foreground: '#433422',
      background: '#f4ecd8',
      cursor: '#7a5c2e',
      cursorAccent: '#f4ecd8',
      selectionBackground: '#e3d3a8',
      black: '#433422',
      red: '#a8322d',
      green: '#5a7d2a',
      yellow: '#b07b00',
      blue: '#3a6ea5',
      magenta: '#8a4f7d',
      cyan: '#2f7d72',
      white: '#7a6a52',
      brightBlack: '#6b5a40',
      brightRed: '#c14a40',
      brightGreen: '#6f9636',
      brightYellow: '#caa000',
      brightBlue: '#4a82bd',
      brightMagenta: '#a5648f',
      brightCyan: '#3a978a',
      brightWhite: '#2b2113',
    },
    chrome: {
      chromeBg: '#efe6cf',
      border: '#a07b3a',
      titlebarFg: '#433422',
      accent: '#a07b3a',
      panelBg: '#f7f0df',
      panelFg: '#433422',
      scrollbar: '#c9b48a',
    },
  },
];

const CHROME_VARS: Record<keyof ChromeTheme, string> = {
  chromeBg: '--chrome-bg',
  border: '--border',
  titlebarFg: '--titlebar-fg',
  accent: '--accent',
  panelBg: '--panel-bg',
  panelFg: '--panel-fg',
  scrollbar: '--scrollbar',
};

/** Push a chrome theme onto the live CSS custom properties (Layer B). */
export function applyChrome(chrome: ChromeTheme): void {
  const root = document.documentElement;
  (Object.keys(CHROME_VARS) as (keyof ChromeTheme)[]).forEach((key) => {
    root.style.setProperty(CHROME_VARS[key], chrome[key]);
  });
}

export function getAllThemes(customThemes: Theme[]): Theme[] {
  return [...PRESETS, ...customThemes];
}

export function findTheme(name: string, customThemes: Theme[]): Theme {
  return getAllThemes(customThemes).find((t) => t.name === name) ?? PRESETS[0];
}
