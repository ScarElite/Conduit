---
name: verify
description: Drive a dev Conduit instance end-to-end (keyboard, mouse, clipboard, screenshots) via CDP to verify renderer/main changes against the real app.
---

# Verifying Conduit changes against the running app

Conduit is the user's daily-driver terminal — an installed copy is almost always
running (and the Claude session may be *inside* it). Never kill the `Conduit`
process; run a side-by-side dev instance instead.

## Launch a dev instance (side-by-side safe)

```powershell
Remove-Item Env:NoDefaultCurrentDirectoryInExePath -ErrorAction SilentlyContinue  # sandbox quirk breaks node-pty rebuilds
$env:CONDUIT_USER_DATA = "<scratchpad>\conduit-devdata"   # own userData => own single-instance lock
npm start -- -- --remote-debugging-port=9222              # double "--": npm -> forge -> electron
```

Run in background; poll `http://127.0.0.1:9222/json` until a `page` target titled
"Conduit" appears (~15-30s). Without `CONDUIT_USER_DATA` the dev instance quits
immediately — the installed app holds the single-instance lock (keyed on userData).

The installed app's process name is `Conduit`; dev instances are `electron` —
`Get-Process electron | Stop-Process` cleans up dev without touching the real app.

## Drive it

`cdp-drive.mjs` and `cdp-eval.mjs` live next to this file (plain Node ≥22, no deps):

```powershell
node cdp-drive.mjs focus                 # focus xterm's hidden textarea (do this first)
node cdp-drive.mjs ctrlv                 # dispatch Ctrl+V (also: ctrlshiftv, enter)
node cdp-drive.mjs rightclick            # right-click terminal center
node cdp-drive.mjs click "200,271"       # left click at CSS px (hovers 300ms first — needed for links)
node cdp-drive.mjs shot out.png          # screenshot -> Read the png to see the terminal
node cdp-eval.mjs "window.term.openExternal" # evaluate JS in the page (awaits promises)
```

To "type" a command into the shell: `Set-Clipboard -Value "echo hi"`, then `ctrlv`,
then `enter`. Screenshot coordinates == input coordinates (verify `devicePixelRatio`
is 1 via cdp-eval if clicks seem to miss).

## Gotchas learned the hard way

- **Prompt-state detection** (`atShellPromptRef`) comes from OSC 133 injected into
  PowerShell only (`src/main/pty.ts`). To simulate "an app is running" (Claude Code
  state) cheaply, start `node` (REPL emits no OSC 133).
- **Clipboard is shared machine state** — the user is on this machine. Back up
  (`Get-Clipboard -Raw` → file) and restore when done.
  `[System.Windows.Forms.Clipboard]::SetImage($bmp)` simulates a Snipping Tool
  screenshot (image, no text). `::Clear()` for the empty case.
- **Default browser is Opera GX** — when watching for "a browser opened", check
  `opera` processes, not just msedge/chrome/firefox.
- **main.ts / preload.ts edits**: forge-vite hot-restarts are flaky (renderer HMRs,
  main restart timing unclear). Kill and relaunch the dev instance to be sure all
  three layers are current.
- node-pty's `conpty_console_list_agent.js` "AttachConsole failed" stacks in the
  dev log are teardown noise from killed ptys, not a real failure.
