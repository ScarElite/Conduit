import * as pty from 'node-pty';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { WebContents } from 'electron';
import { IPC } from '../shared/channels';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 30;

// One pty per renderer (keyed by webContents id) so additional tabs/windows
// can be supported later without touching this module.
const ptys = new Map<number, pty.IPty>();

let detectedShell: string | null = null;

function detectDefaultShell(): string {
  if (detectedShell) return detectedShell;
  // Prefer PowerShell 7 (pwsh.exe) when present, otherwise Windows PowerShell.
  try {
    execFileSync('where', ['pwsh.exe'], { stdio: 'ignore' });
    detectedShell = 'pwsh.exe';
  } catch {
    detectedShell = 'powershell.exe'; // always present on supported Windows
  }
  return detectedShell;
}

/** The shell executable Conduit will spawn (honors the override, else auto-detect). */
export function resolveShellExecutable(override?: string): string {
  return override && override.trim() ? override.trim() : detectDefaultShell();
}

function isPowerShell(file: string): boolean {
  const base = path.basename(file).toLowerCase().replace(/\.exe$/, '');
  return base === 'powershell' || base === 'pwsh';
}

// Injected at shell startup (PowerShell only) so OSC 133 command-completion
// markers are ALWAYS emitted. This makes the completion ding a simple on/off
// toggle — no $PROFILE edits, no install step, no restart. It wraps any existing
// prompt (preserving it) and only reports a NEW history entry, so an empty Enter
// after a long command doesn't re-ding. The marker carries the exit code and the
// command duration (from PowerShell's own history timing):
//   ESC ] 133 ; D ; <exit> ; <durationMs> ESC \
const PROMPT_SETUP = String.raw`if ((Test-Path Function:\prompt) -and -not (Test-Path Function:\__Conduit_OriginalPrompt)) {
  Rename-Item Function:\prompt __Conduit_OriginalPrompt -ErrorAction SilentlyContinue
}
function Global:prompt {
  $exit = $LASTEXITCODE
  if ($null -eq $exit) { $exit = 0 }
  $esc = [char]27
  $h = Get-History -Count 1 -ErrorAction SilentlyContinue
  if ($h -and $h.Id -ne $Global:__Conduit_LastHistId) {
    $Global:__Conduit_LastHistId = $h.Id
    $durMs = 0
    if ($h.EndExecutionTime -and $h.StartExecutionTime) {
      $durMs = [int](($h.EndExecutionTime - $h.StartExecutionTime).TotalMilliseconds)
    }
    [Console]::Write("$esc]133;D;$exit;$durMs$esc\")
  }
  [Console]::Write("$esc]133;A$esc\")
  if (Test-Path Function:\__Conduit_OriginalPrompt) {
    return (& __Conduit_OriginalPrompt)
  }
  return "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) "
}
$__cH = Get-History -Count 1 -ErrorAction SilentlyContinue
if ($__cH) { $Global:__Conduit_LastHistId = $__cH.Id }`;

function buildShellArgs(file: string): string[] {
  if (isPowerShell(file)) {
    // -EncodedCommand avoids all command-line escaping; -NoExit keeps the shell
    // interactive after the setup runs (which produces no visible output).
    const encoded = Buffer.from(PROMPT_SETUP, 'utf16le').toString('base64');
    return ['-NoExit', '-EncodedCommand', encoded];
  }
  return [];
}

/**
 * Spawn a shell bound to a renderer's WebContents. Output and exit are pushed
 * straight to that renderer. Safe to call again for the same renderer (e.g.
 * after a dev reload) — any existing pty for it is killed first.
 */
export function spawnPtyForContents(
  contents: WebContents,
  cols = DEFAULT_COLS,
  rows = DEFAULT_ROWS,
  shellOverride?: string,
): void {
  const id = contents.id;
  killPtyForContents(id);

  const file = resolveShellExecutable(shellOverride);
  const proc = pty.spawn(file, buildShellArgs(file), {
    name: 'xterm-256color',
    cols: cols > 0 ? cols : DEFAULT_COLS,
    rows: rows > 0 ? rows : DEFAULT_ROWS,
    cwd: os.homedir(),
    env: process.env as Record<string, string>,
  });

  ptys.set(id, proc);

  proc.onData((data) => {
    if (!contents.isDestroyed()) contents.send(IPC.PTY_DATA, data);
  });

  proc.onExit(({ exitCode }) => {
    // kill() is asynchronous, so a pty killed during respawn/reload fires its
    // exit on a later tick — by which point the replacement already owns this
    // id's map slot. Only the currently-mapped pty may act on its own exit.
    if (ptys.get(id) !== proc) return;
    ptys.delete(id);
    if (!contents.isDestroyed()) contents.send(IPC.PTY_EXIT, exitCode);
  });
}

export function writeToPty(id: number, data: string): void {
  ptys.get(id)?.write(data);
}

export function resizePty(id: number, cols: number, rows: number): void {
  const proc = ptys.get(id);
  if (!proc) return;
  if (cols > 0 && rows > 0) {
    try {
      proc.resize(cols, rows);
    } catch {
      // node-pty can throw transiently mid-teardown; the next resize corrects it.
    }
  }
}

export function killPtyForContents(id: number): void {
  const proc = ptys.get(id);
  if (!proc) return;
  try {
    proc.kill();
  } catch {
    // already gone
  }
  ptys.delete(id);
}
