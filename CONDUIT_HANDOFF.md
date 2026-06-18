# Conduit — Build Handoff

> **Working name:** Conduit. If you pick a different name, find-replace `Conduit` / `conduit` throughout this doc and the repo.
>
> **What this is:** A custom, fully themeable terminal emulator for Windows that runs PowerShell (and `claude`, bash, etc.) exactly like the built-in terminal — but where every color, font, and behavior is yours to change live. Built to optionally live as a panel inside the existing Hub app alongside V.

This document is the spec. Build it in phases, in order. Don't skip Phase 0 — the native-module setup is the part that wastes the most time if rushed.

---

## 1. What it must do (acceptance criteria)

A build is "done" for v1 when all of these are true:

1. Launches a real PowerShell session and behaves identically to Windows Terminal for normal use (prompt, command history, `claude` runs inside it, colors from programs render correctly, resizing reflows).
2. A **Settings** button opens a panel where the user can change colors for: window border/chrome, normal text (foreground), background, the input line, cursor, selection, and the full 16-color ANSI palette (which is what controls how command/output colors actually appear — see §6). Changes apply **live**, no restart.
3. **Themes**: a set of named presets (each a complete color set) selectable from a dropdown; selecting one updates everything instantly. User-created themes persist across restarts.
4. **Image paste**: when the user copies a screenshot with the Windows Snipping Tool (image on the clipboard) and presses Ctrl+V, the image is displayed inline in the terminal — not pasted as garbage text.
5. **Audio ding**: an optional, toggleable sound that plays when a long-running command finishes.
6. Settings (theme, font, toggles) persist to disk and reload on next launch.

---

## 2. Stack (use these exact packages)

> ⚠️ The xterm packages were renamed in 2024. The old `xterm` and `xterm-addon-*` packages are **deprecated**. Use the scoped `@xterm/*` packages below. Anything online referencing `import { Terminal } from 'xterm'` is outdated.

**Shell + rendering**
- `electron` — app shell (latest stable)
- `node-pty` — the actual pseudoterminal that runs PowerShell. Uses Windows ConPTY; **requires Windows 10 build 1809+** (fine on any modern machine). This is a **native module** — see Phase 0.
- `@xterm/xterm` (v6.x) — terminal rendering engine (same one VS Code, Hyper, Tabby use)
- `@xterm/addon-fit` — reflows the terminal to fill its container on resize
- `@xterm/addon-webgl` — GPU-accelerated renderer (smooth, fast)
- `@xterm/addon-web-links` — makes URLs clickable
- `@xterm/addon-search` — find-in-buffer (nice-to-have, wire in Phase 4)
- `@xterm/addon-image` — inline image protocol support (Sixel / iTerm IIP); optional path for image paste, see §7
- `@xterm/addon-clipboard` — OSC 52 clipboard access

**Tooling / scaffold**
- **Electron Forge** with the **Vite + TypeScript** template. Use Forge specifically because it runs `@electron/rebuild` automatically, which solves the native-module pain for you.
- **React** for the UI chrome (settings panel, tabs, theme picker). If integrating into the Hub later, match whatever the Hub uses. Vanilla TS works too, but React makes the settings panel much easier.

**Persistence**
- `electron-store` — typed JSON settings store in the user-data dir. Simple, reliable, handles the "save theme + toggles, reload on launch" requirement.

Install (after scaffolding — see Phase 0):
```bash
npm install node-pty @xterm/xterm @xterm/addon-fit @xterm/addon-webgl @xterm/addon-web-links @xterm/addon-search @xterm/addon-image @xterm/addon-clipboard electron-store
```

---

## 3. Architecture & security model

Electron has two process types. Keep them strictly separated — this matters because we run a live shell, so a lax setup is a real security hole.

```
┌─────────────────────────── MAIN PROCESS (Node.js) ───────────────────────────┐
│  • Owns node-pty: spawns powershell.exe, reads its output, writes input        │
│  • Owns the clipboard (clipboard.readImage())                                  │
│  • Owns electron-store (settings on disk)                                      │
│  • Exposes a NARROW, typed API to the renderer via IPC                         │
└───────────────────────────────────┬───────────────────────────────────────────┘
                                     │  contextBridge (preload.ts)
┌────────────────────────────────────▼──────────────────────────────────────────┐
│  RENDERER PROCESS (Chromium) — your UI                                          │
│  • xterm.js draws the terminal                                                  │
│  • React renders chrome: title bar, settings panel, theme picker                │
│  • Sends keystrokes → main; receives output → writes to xterm                   │
│  • NO direct Node access. Talks to main only through the preload bridge.        │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Hard rules for the BrowserWindow:**
```ts
webPreferences: {
  contextIsolation: true,   // required
  nodeIntegration: false,   // required — renderer must NOT have raw Node
  sandbox: false,           // node-pty work happens in main, but sandbox interferes with some preload patterns; keep false unless you confirm otherwise
  preload: /* path to preload.js */,
}
```

**The IPC contract** (define in preload, implement in main). Keep it this small:
```ts
// exposed on window.term
interface TermBridge {
  onData(cb: (data: string) => void): void;   // pty -> renderer (terminal output)
  write(data: string): void;                   // renderer -> pty (keystrokes)
  resize(cols: number, rows: number): void;    // renderer -> pty
  getClipboardImage(): Promise<string | null>; // returns base64 PNG data URL, or null if clipboard has no image
  loadSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  onCommandFinished(cb: (exitCode: number) => void): void; // for the ding, see §8
}
```

**The output→input loop, conceptually:**
- Main: `ptyProcess.onData(d => mainWindow.webContents.send('pty:data', d))`
- Renderer: `window.term.onData(d => xterm.write(d))`
- Renderer: `xterm.onData(d => window.term.write(d))` (xterm's `onData` fires on keystrokes)
- Renderer on resize (via fit addon): `window.term.resize(cols, rows)` → main calls `ptyProcess.resize(cols, rows)`

Spawning the shell in main:
```ts
import * as pty from 'node-pty';
const shell = 'powershell.exe'; // or pwsh.exe for PowerShell 7 if installed
const ptyProcess = pty.spawn(shell, [], {
  name: 'xterm-256color',
  cols: 80, rows: 30,
  cwd: process.env.USERPROFILE,
  env: process.env,
});
```

---

## 4. Project structure

```
conduit/
├─ src/
│  ├─ main/
│  │  ├─ main.ts            # app lifecycle, BrowserWindow, IPC handlers
│  │  ├─ pty.ts             # node-pty spawn + data/resize plumbing
│  │  ├─ clipboard.ts       # readImage -> base64 data URL
│  │  └─ settings.ts        # electron-store wrapper + defaults
│  ├─ preload/
│  │  └─ preload.ts         # contextBridge.exposeInMainWorld('term', {...})
│  ├─ renderer/
│  │  ├─ index.html
│  │  ├─ app.tsx            # React root: title bar + terminal host + settings
│  │  ├─ Terminal.tsx       # xterm init, addon loading, theme application
│  │  ├─ SettingsPanel.tsx  # color pickers, theme dropdown, toggles
│  │  ├─ ImageOverlay.tsx   # inline image rendering (see §7)
│  │  └─ themes.ts          # preset theme definitions (see §6)
│  └─ shared/
│     └─ types.ts           # Settings, Theme, IPC channel names (shared main/renderer)
├─ assets/
│  └─ sounds/ding.wav       # default completion sound
├─ forge.config.ts
├─ package.json
└─ CONDUIT_HANDOFF.md   # this file
```

---

## 5. Phase 0 — Scaffold & get a working terminal (do this first)

**Goal:** PowerShell running inside an Electron window, reflowing on resize. No theming yet. This proves the hardest plumbing works before you build features on it.

1. Scaffold with Forge + Vite + TS:
   ```bash
   npm init electron-app@latest conduit -- --template=vite-typescript
   cd conduit
   ```
2. Install the deps from §2.
3. **Native module rebuild for node-pty.** Forge's Vite template should rebuild native modules automatically. If you hit a `node-pty` load error at runtime (a `.node` ABI mismatch), it means the rebuild didn't run for Electron's Node version. Fix:
   ```bash
   npm install --save-dev @electron/rebuild
   npx electron-rebuild -f -w node-pty
   ```
   (Use `@electron/rebuild`, not the old deprecated `electron-rebuild` package.) Also ensure `node-pty` is **unpacked from asar** when you package — add to `forge.config.ts` packagerConfig: `asar: { unpack: '**/node_modules/node-pty/**' }`.
   - Prereqs on the machine: a C++ build toolchain. Easiest is `winget install Microsoft.VisualStudio.2022.BuildTools` with the "Desktop development with C++" workload, plus Python 3. Forge will tell you if something's missing.
4. Wire the IPC loop from §3. Set up the BrowserWindow with the security flags.
5. Load `@xterm/addon-fit` and `@xterm/addon-webgl`. Call `fitAddon.fit()` on window resize (debounce it) and push the resulting cols/rows to the pty.
6. **Checkpoint:** you can type `Get-ChildItem`, see colored output, run `claude`, resize the window and have text reflow. Commit.

---

## 6. Phase 1 — Theming engine + Settings panel

### How terminal color actually works (read this — it shapes the whole feature)

xterm.js renders whatever bytes the shell sends. When PowerShell prints colored text, it emits **ANSI escape codes** like "switch to color #4." The terminal doesn't decide *which* text is a command vs. output vs. an error — the shell does. What the terminal owns is the **palette**: the actual RGB values that codes 0–15 map to, plus foreground, background, cursor, and selection.

So the settings panel controls two layers:

**Layer A — xterm theme** (`ITheme` object, applied via `term.options.theme = {...}`):
```ts
interface ITheme {
  foreground: string; background: string;
  cursor: string; cursorAccent: string; selectionBackground: string;
  black: string;        red: string;          green: string;       yellow: string;
  blue: string;         magenta: string;      cyan: string;        white: string;
  brightBlack: string;  brightRed: string;    brightGreen: string; brightYellow: string;
  brightBlue: string;   brightMagenta: string;brightCyan: string;  brightWhite: string;
}
```
Changing any of these and reassigning `term.options.theme` updates the live terminal **instantly** — that's your "change colors at any time."

**Layer B — window chrome** (CSS variables on the renderer): border, title bar, settings panel, scrollbar. These are pure CSS, not xterm:
```css
:root {
  --chrome-bg: #0a0e14;
  --border: #1f6feb;
  --titlebar-fg: #c9d1d9;
  --accent: #58a6ff;   /* your holo accent */
}
```
The settings panel writes to these variables live via `document.documentElement.style.setProperty('--border', value)`.

> **Important nuance to surface to the user:** "command color," "parameter color," "string color" inside PowerShell are controlled by **PSReadLine**, not the terminal — they're configured in the PowerShell `$PROFILE` (e.g. `Set-PSReadLineOption -Colors @{ Command = '...'; Parameter = '...' }`). The terminal sets the *palette those map to*. So the panel can offer full palette control (which covers "responses," "errors," most output), and for true per-token PSReadLine control, optionally let the user edit a PSReadLine color block that Conduit writes into their profile. Treat the PSReadLine integration as a Phase 4 stretch; the 16-color palette + fg/bg/cursor/selection covers the bulk of what "change the colors of everything" means in practice.

### A theme is just data

```ts
// shared/types.ts
interface Theme {
  name: string;
  xterm: ITheme;                 // Layer A
  chrome: Record<string, string>; // Layer B css vars: border, chromeBg, titlebarFg, accent, ...
  font: { family: string; size: number; ligatures: boolean };
}
interface Settings {
  activeTheme: string;
  customThemes: Theme[];
  dingEnabled: boolean;
  dingThresholdMs: number;  // only ding for commands longer than this; default 5000
  dingSound: string;        // path or built-in id
  windowOpacity: number;    // 1.0 = opaque; <1 enables transparency
}
```

### Build steps
1. Define 3–4 preset themes in `themes.ts`. Suggested starters: a **Holo** theme as the flagship (dark navy/black bg, cyan/blue holo accents matching the vlime aesthetic — this is the one that ties Conduit to V), a classic green-on-black, a high-contrast light theme, and a warm **Parchment** theme (cream bg, ink-brown text) for contrast. Each is a full `Theme` object.
2. Build `SettingsPanel.tsx`: a slide-out panel with (a) a theme dropdown, (b) a labeled color picker for every field in `ITheme` and every chrome CSS var, (c) the font controls, (d) toggles for ding + transparency. Use `<input type="color">` plus a hex field for each.
3. Wire **live application**: any change → update `term.options.theme` (Layer A) and/or `document.documentElement.style.setProperty` (Layer B) immediately. No "apply" button needed; it's live.
4. "Save as new theme" → push to `customThemes`, persist via `window.term.saveSettings`.
5. On launch, `loadSettings()` → apply `activeTheme` before first render.
6. **Checkpoint:** switch themes from the dropdown and watch everything recolor instantly; tweak the border color and see it change; restart and your settings survive. Commit.

---

## 7. Phase 2 — Image paste from Snipping Tool

**Why it works:** Snipping Tool puts a *bitmap* on the clipboard (not text, not a file path). WhatsApp can show it because it reads clipboard image data. Electron's `clipboard.readImage()` (main process) does exactly that. A normal terminal can't display images, but **you own this one** — so you render the image as an overlay.

**Recommended approach — HTML overlay (full fidelity, reliable):**
1. Intercept paste in the renderer. Attach a `paste` listener, or override Ctrl+V via `term.attachCustomKeyEventHandler`.
2. On paste, call `window.term.getClipboardImage()`. In main:
   ```ts
   import { clipboard } from 'electron';
   const img = clipboard.readImage();
   return img.isEmpty() ? null : img.toDataURL(); // base64 PNG data URL
   ```
3. If it returns null (no image), fall through to normal text paste (`term.paste(text)`).
4. If it returns a data URL: render an `<img>` positioned in the terminal's scrollback at the current cursor row. The simplest robust version: reserve vertical space by writing N blank lines to the pty's display (or just append the image into a scrolling overlay layer that tracks `term.buffer.active.viewportY`), and absolutely-position the `<img>` over that gap. Store pasted images in an array with their buffer line so they scroll naturally with content.

> The overlay approach gives you full color, full resolution, click-to-enlarge, and it doesn't depend on terminal graphics protocols. It's more code than the alternative but it's the one that behaves like WhatsApp.

**Alternative — `@xterm/addon-image` (Sixel / iTerm IIP):** Load the addon and emit the image as an iTerm inline-image escape sequence. Less custom code, but lower fidelity for big screenshots and it's a terminal protocol rather than a true overlay. Fine as a fallback; the overlay is the better fit for what you described.

**⚠️ The `claude`-is-running caveat:** when Claude Code (or any full-screen TUI) owns the terminal, a paste goes to *that program*, not to your shell prompt. If you want a pasted screenshot to reach Claude Code so it can *see* the image, that depends on Claude Code's own paste handling, which differs from displaying it in your scrollback. For v1, scope this feature to "display the image inline in the terminal." Routing images *into* a running TUI is a separate, harder problem — flag it as a future investigation, not a v1 promise.

**Checkpoint:** snip a screenshot, Ctrl+V at the prompt, see it appear inline; paste normal text and confirm it still pastes as text. Commit.

---

## 8. Phase 3 — Audio ding on command completion

**The hard part is knowing when a command "finished."** The shell just streams bytes; there's no built-in "done" event. Two signals, best first:

**Primary — OSC 133 shell integration (reliable, gives exit codes).** This is the same mechanism Windows Terminal and VS Code use. PowerShell emits special escape sequences marking prompt/command boundaries. You make PowerShell emit them by adding a prompt hook to the user's `$PROFILE`. The key marker is `133;D` = "command finished" (optionally with the exit code). Conduit watches the pty data stream for these markers.

Add this to the PowerShell profile (Conduit can offer a one-click "install shell integration" button that appends it):
```powershell
# OSC 133 prompt markers for Conduit
function Global:__Conduit_Prompt {
  $exit = $LASTEXITCODE
  $esc = [char]27
  # 133;D = command finished (with exit code); 133;A = prompt start
  Write-Host -NoNewline "$esc]133;D;$exit$esc\"
  Write-Host -NoNewline "$esc]133;A$esc\"
  # ... your normal prompt below ...
  return "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) "
}
Set-Item function:prompt (Get-Item function:__Conduit_Prompt).ScriptBlock
```
In the renderer, register a parser hook for the OSC 133 sequence (xterm exposes `term.parser.registerOscHandler(133, handler)`), and when you see a `D` (command end) after a command that started more than `dingThresholdMs` ago, fire `onCommandFinished(exitCode)` → play the sound. Track command start from the `133;C` (output start) or `133;B` marker.

**Fallback — terminal bell (`BEL`, `\x07`).** Many programs emit a bell when done. xterm fires `term.onBell(() => ...)`. Simpler but less reliable and not tied to "your" command. Wire it as a secondary trigger.

**Playing the sound:** in the renderer, `new Audio(soundPath).play()`. Gate it behind `settings.dingEnabled` and the `dingThresholdMs` so short commands don't constantly beep. Let the user pick the sound file and test it from the settings panel.

**Checkpoint:** run a `Start-Sleep 6; "done"`, hear the ding; toggle it off and confirm silence; run a fast command and confirm no ding (under threshold). Commit.

---

## 9. Phase 4 — Extras (pick what you want, any order)

These are the "many other things if I desired" hooks. None are required for v1.

- **Command palette** — Ctrl+Shift+P overlay for theme switching, settings, "install shell integration," clear, etc.
- **Tabs / splits** — multiple pty sessions; each tab is its own `node-pty` + `xterm` instance.
- **Transparency / blur** — `BrowserWindow({ transparent: true })` + `win.setOpacity()` bound to the opacity slider. (Set `transparent: true` at creation; it can't be toggled after.)
- **Custom fonts & ligatures** — font family/size already in the theme; add `@xterm/addon-ligatures` for programming-font ligatures.
- **Find-in-buffer** — wire `@xterm/addon-search` to a Ctrl+F box.
- **Hub integration** — extract the `<Terminal>` component so it can mount as a panel in the Hub. Since the Hub is already Electron, the pty plumbing can move into the Hub's main process; V can read the pty output stream (the same `onData` feed) to "watch," and `write()` to "drive" it. Keep the IPC contract from §3 as the seam.
- **PSReadLine color sync** — the deeper per-token color control mentioned in §6.

---

## 10. Known gotchas (the stuff that eats afternoons)

1. **Native module ABI mismatch.** If node-pty throws on load, it was built for the wrong Node version. Run `npx electron-rebuild -f -w node-pty`. Re-run after every Electron version bump.
2. **asar packaging.** Native `.node` files must be unpacked from the asar archive or they won't load in a packaged build. Set the `asar.unpack` glob (§5.3).
3. **Don't block the main process.** Heavy work in main freezes the UI. Keep main lean — pty I/O, clipboard, settings.
4. **Resize timing.** Call `fit()` after the DOM has laid out (and on a debounced resize), then push cols/rows to the pty. Resizing the pty without resizing xterm (or vice-versa) causes garbled reflow.
5. **WebGL renderer context loss.** The `@xterm/addon-webgl` renderer can lose its GL context (e.g. GPU sleep); listen for the context-loss event and dispose/recreate, or fall back to the DOM renderer.
6. **ConPTY requires Windows 1809+.** A non-issue on any current machine, but worth a friendly error if someone runs it on something ancient.
7. **Security.** Never set `nodeIntegration: true` to "make things easier." The renderer runs a live shell's output; keep `contextIsolation` on and the IPC surface narrow.

---

## 11. Suggested build order (summary)

```
Phase 0  Scaffold + PowerShell running + resize          ← proves the plumbing
Phase 1  Theming engine + live settings + presets        ← the headline feature
Phase 2  Image paste (HTML overlay)                       ← the WhatsApp-style one
Phase 3  Audio ding via OSC 133 (+ BEL fallback)
Phase 4  Extras: palette, tabs, transparency, Hub panel
```

Commit at every checkpoint. Each phase stands on its own, so you always have a working terminal even mid-build.
