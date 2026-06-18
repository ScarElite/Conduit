# Conduit

A custom, fully themeable terminal emulator for Windows. Runs PowerShell, `claude`, bash, and anything else exactly like the built-in terminal — but every color, font, and behavior is yours to change live. Built to optionally dock as a panel in the Hub alongside V.

## Why

Windows Terminal is fine, but it isn't *mine*. Conduit is: live theme switching, a real settings panel for every color, inline image paste from the Snipping Tool, optional completion sounds, and room to add whatever else I want — owning 100% of the chrome and behavior around the shell.

## Stack

- **Electron** (+ Electron Forge, Vite, TypeScript) — app shell
- **node-pty** — the real pseudoterminal (ConPTY backend; Windows 10 1809+)
- **@xterm/xterm** v6 + addons (`fit`, `webgl`, `web-links`, `search`, `image`, `clipboard`) — rendering engine
- **React 19** — settings panel and chrome (pinned to match V's Hub)
- **electron-store** — persisted settings

> Note: use the scoped `@xterm/*` packages. The old `xterm` / `xterm-addon-*` packages are deprecated.

## Features (v1)

- [x] PowerShell session that behaves like Windows Terminal (Phase 0)
- [x] Live theming: border, text, background, cursor, selection, full ANSI palette (Phase 1)
- [x] Theme presets (Vlime, Holo, Green Classic, High-Contrast Light, Parchment) + user-saved themes, persisted across restarts (Phase 1)
- [x] Inline image paste from the Windows Snipping Tool — anchored HTML overlay, click-to-enlarge (Phase 2)
- [x] Optional audio ding on command completion via OSC 133 shell integration + BEL fallback (Phase 3)

See **CONDUIT_HANDOFF.md** for the full architecture, phased build plan, and gotchas.

## Embeddable terminal component

The terminal is split at a hard `PtyApi` boundary so it can drop into V's Command Hub as
a panel without a rewrite. `src/renderer/Terminal.tsx` is a host-agnostic React component —
it imports only `@xterm/*` (never `electron`/`node-pty`) and is driven by an injected pty:

```ts
interface PtyApi {
  onData(cb: (chunk: string) => void): () => void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onExit?(cb: (code: number) => void): () => void;
  kill?(): void;
}

// <Terminal ptyApi={pty} theme={xtermITheme} fontFamily="…" fontSize={14} onTitle={…} />
```

The standalone app implements `PtyApi` over the preload bridge (`window.term`); the Hub
implements it over its own `node-pty` in its main process. Same contract → no rewrite.

## Getting started

```bash
npm install          # installs deps and applies patches/ via the postinstall hook
npm run rebuild      # rebuild node-pty for Electron's ABI (= electron-rebuild -f -w node-pty)
npm start            # dev (Vite + Electron)

npm run typecheck    # tsc --noEmit
npm run package      # build a runnable app under out/
```

**Prereqs:** Windows 10 1809+, Node 18+, and a C++ build toolchain for node-pty
(`winget install Microsoft.VisualStudio.2022.BuildTools` with the "Desktop development
with C++" workload, plus Python 3).

> **node-pty + Spectre:** node-pty's Windows build requests Spectre-mitigated MSVC
> libraries. Rather than require that VS component, Conduit disables the flag via
> `patch-package` (`patches/node-pty+1.1.0.patch`, re-applied automatically by the
> `postinstall` hook). For the hardened build instead, install the "MSVC v143
> Spectre-mitigated libs" component in the VS Installer and delete the patch.

## Status

**v1 built.** All of Phases 0–3 are implemented. Phase 0 (node-pty/ConPTY PowerShell
session, IPC loop, resize) and packaging (`npm run package` → a launchable app that spawns
PowerShell) are verified end-to-end; theming, image paste, and the completion ding are
implemented and typecheck-clean. Hardened against a 16-finding adversarial review.

## License

Private / personal project.
