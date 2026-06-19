import type { ChromeTheme, Theme, XtermTheme } from '../shared/types';

// JetBrains Mono leads (V's Command Center font) with graceful fallbacks —
// Cascadia Code ships with modern Windows. We avoid a remote Google-Fonts
// @import because Conduit's production CSP blocks it; JetBrains Mono is used if
// installed locally, otherwise the stack degrades cleanly.
const MONO =
  '"JetBrains Mono", "Cascadia Code", "Fira Code", Consolas, ui-monospace, monospace';

/** HSL (h in deg, s/l in 0–100) → #rrggbb. CSS Color 4 reference conversion. */
function hslHex(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    const color = lN - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * color);
  };
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

/**
 * The vlime family, ported from V's Command Center. Like the Hub, every palette
 * is derived from a few accent knobs (hue / saturation / lightness + glow): the
 * structure (near-black green-tinted background, warm light foreground, shared
 * ANSI 16) stays constant and only the accent — cursor, borders, brackets, glow,
 * selection, scrollbar — shifts. Add a palette by adding one line below.
 */
interface VlimeKnobs {
  h: number;
  s: number;
  l: number;
  /** HUD glow intensity (Hub's --hub-glow-strength). */
  glow?: number;
  /** Optional background-lightness override (noir goes darker). */
  bgL?: number;
}

// Background hue/saturation shared across the family: near-black with a whisper
// of green (matches the Hub's `--background: 150 9% 3.5%`).
const BG_H = 150;
const BG_S = 9;

// Program (ANSI 16) colors — palette-neutral and well-tuned, kept constant so
// colored CLI output stays predictable as you switch accent palettes.
const VLIME_ANSI = {
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
} satisfies Partial<XtermTheme>;

/** Build a Hub-faithful (light text, accent everything-else) vlime theme. */
function makeVlime(name: string, { h, s, l, glow = 1, bgL = 3.5 }: VlimeKnobs): Theme {
  const accent = hslHex(h, s, l);
  const bg = hslHex(BG_H, BG_S, bgL);
  const panelBg = hslHex(BG_H, BG_S, bgL + 2.5);
  const fg = hslHex(90, 6, 90); // warm light gray (Hub foreground), shared
  // Accent-derived chrome — saturation clamped so low-sat palettes (mono) stay
  // muted instead of forcing a green tint.
  const border = hslHex(h, Math.min(s, 45), 22);
  const selection = hslHex(h, Math.min(s, 42), 18);
  const scrollbar = hslHex(h, Math.min(s, 32), 30);
  return {
    name,
    glowStrength: glow,
    font: { family: MONO, size: 14, ligatures: false },
    xterm: {
      foreground: fg,
      background: bg,
      cursor: accent,
      cursorAccent: bg,
      selectionBackground: selection,
      ...VLIME_ANSI,
    },
    chrome: {
      chromeBg: bg,
      border,
      titlebarFg: fg,
      accent,
      panelBg,
      panelFg: fg,
      scrollbar,
    },
  };
}

/**
 * Preset themes — the 13-palette vlime family (V's Command Center look), in the
 * same order as the Hub's settings grid. "Lime" (light text + lime accents) is
 * the flagship default. A theme is just data.
 */
export const PRESETS: Theme[] = [
  makeVlime('Lime', { h: 104, s: 86, l: 60, glow: 1 }),
  makeVlime('Bright', { h: 90, s: 95, l: 60, glow: 1.5 }),
  makeVlime('Emerald', { h: 152, s: 80, l: 47, glow: 1.1 }),
  makeVlime('Cyan', { h: 184, s: 85, l: 50, glow: 1.15 }),
  makeVlime('Ice', { h: 202, s: 90, l: 62, glow: 1.15 }),
  makeVlime('Violet', { h: 266, s: 82, l: 68, glow: 1.25 }),
  makeVlime('Synthwave', { h: 318, s: 88, l: 64, glow: 1.35 }),
  makeVlime('Magenta', { h: 330, s: 90, l: 60, glow: 1.3 }),
  makeVlime('Crimson', { h: 352, s: 82, l: 57, glow: 1.2 }),
  makeVlime('Amber', { h: 38, s: 95, l: 55, glow: 1.1 }),
  makeVlime('Gold', { h: 46, s: 90, l: 58, glow: 1.0 }),
  makeVlime('Mono', { h: 150, s: 5, l: 82, glow: 0.5 }),
  makeVlime('Noir', { h: 104, s: 55, l: 50, glow: 0.4, bgL: 2.5 }),
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

/** Push the HUD glow intensity onto the live `--hub-glow-strength` variable. */
export function applyGlow(glowStrength: number | undefined): void {
  document.documentElement.style.setProperty(
    '--hub-glow-strength',
    String(glowStrength ?? 1),
  );
}

export function getAllThemes(customThemes: Theme[]): Theme[] {
  return [...PRESETS, ...customThemes];
}

export function findTheme(name: string, customThemes: Theme[]): Theme {
  return getAllThemes(customThemes).find((t) => t.name === name) ?? PRESETS[0];
}
