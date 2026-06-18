# Conduit

A custom, fully themeable terminal emulator for Windows. Runs PowerShell, `claude`, bash, and anything else exactly like the built-in terminal — but every color, font, and behavior is yours to change live. Built to optionally dock as a panel in the Hub alongside V.

## Why

Windows Terminal is fine, but it isn't *mine*. Conduit is: live theme switching, a real settings panel for every color, inline image paste from the Snipping Tool, optional completion sounds, and room to add whatever else I want — owning 100% of the chrome and behavior around the shell.

## Stack

- **Electron** (+ Electron Forge, Vite, TypeScript) — app shell
- **node-pty** — the real pseudoterminal (ConPTY backend; Windows 10 1809+)
- **@xterm/xterm** v6 + addons (`fit`, `webgl`, `web-links`, `search`, `image`, `clipboard`) — rendering engine
- **React** — settings panel and chrome
- **electron-store** — persisted settings

> Note: use the scoped `@xterm/*` packages. The old `xterm` / `xterm-addon-*` packages are deprecated.

## Features (v1)

- [ ] PowerShell session that behaves like Windows Terminal (Phase 0)
- [ ] Live theming: border, text, background, cursor, selection, full ANSI palette (Phase 1)
- [ ] Theme presets + user-saved themes, persisted across restarts (Phase 1)
- [ ] Inline image paste from the Windows Snipping Tool (Phase 2)
- [ ] Optional audio ding on command completion via OSC 133 (Phase 3)

See **CONDUIT_HANDOFF.md** for the full architecture, phased build plan, and gotchas.

## Getting started

```bash
# scaffold (already done if this repo exists)
npm install

# rebuild the native module for Electron's Node version (run after any Electron bump)
npx electron-rebuild -f -w node-pty

# dev
npm start
```

**Prereqs:** Windows 10 1809+, Node, and a C++ build toolchain for node-pty
(`winget install Microsoft.VisualStudio.2022.BuildTools` with the "Desktop development with C++" workload, plus Python 3).

## Status

Pre-Phase 0. Building in order — each phase leaves a working terminal.

## License

Private / personal project.
