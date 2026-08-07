import * as pty from 'node-pty';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { WebContents } from 'electron';
import { IPC } from '../shared/channels';
import type { Shortcut } from '../shared/types';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 30;

// One pty per pane (keyed by a renderer-generated paneId) so a single window can
// run many independent shells across tabs/splits. Each record remembers which
// WebContents owns it, so all of a window's shells can be reaped when it closes.
const ptys = new Map<string, { proc: pty.IPty; wcId: number }>();

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

/** PowerShell single-quoted literal — the only quoting that never interpolates. */
function psLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

// A shortcut name becomes a function name, so it has to be one PowerShell can
// call bare — anything else would need call-operator syntax and defeat the point
// of just typing `rf`.
const SHORTCUT_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

// -EncodedCommand travels on the command line, which Windows caps around 32k
// characters (and base64 of UTF-16LE is ~2.7x the source). Stop well short
// rather than risk a shell that won't spawn at all.
const MAX_SETUP_CHARS = 10000;

/**
 * Compile the user's shortcuts into PowerShell functions, injected at spawn
 * next to PROMPT_SETUP. They become real commands — so they tab-complete,
 * compose, and forward arguments (`rf --continue`) like anything else.
 *
 * A missing folder aborts with a warning instead of running the command in
 * whatever directory the shell happened to be sitting in.
 */
function buildShortcutSetup(shortcuts: Shortcut[]): string {
  const out: string[] = [];
  const seen = new Set<string>();
  let size = 0;
  for (const sc of shortcuts ?? []) {
    const name = (sc?.name ?? '').trim();
    const folder = (sc?.folder ?? '').trim();
    const command = (sc?.command ?? '').trim();
    if (!SHORTCUT_NAME.test(name) || seen.has(name.toLowerCase())) continue;
    if (!folder && !command) continue;
    seen.add(name.toLowerCase());

    const body: string[] = [];
    if (folder) {
      const lit = psLiteral(folder);
      const warn = psLiteral(`Conduit shortcut '${name}': folder not found - ${folder}`);
      body.push(`  if (-not (Test-Path -LiteralPath ${lit})) { Write-Warning ${warn}; return }`);
      body.push(`  Set-Location -LiteralPath ${lit}`);
    }
    if (command) {
      // Forward extra arguments only for a single simple invocation — splatting
      // into a compound statement would attach them to whatever ran last.
      const simple = !/[;|&\r\n><]/.test(command);
      body.push(`  ${simple ? `${command} @args` : command}`);
    }
    const fn = `function Global:${name} {\n${body.join('\n')}\n}`;
    if (size + fn.length > MAX_SETUP_CHARS) break;
    size += fn.length;
    out.push(fn);
  }
  return out.join('\n');
}

function buildShellArgs(file: string, shortcuts: Shortcut[]): string[] {
  if (isPowerShell(file)) {
    // -EncodedCommand avoids all command-line escaping; -NoExit keeps the shell
    // interactive after the setup runs (which produces no visible output).
    const shortcutSetup = buildShortcutSetup(shortcuts);
    const script = shortcutSetup ? `${PROMPT_SETUP}\n${shortcutSetup}` : PROMPT_SETUP;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    return ['-NoExit', '-EncodedCommand', encoded];
  }
  return []; // non-PowerShell shells get no injection (same as the prompt setup)
}

/**
 * Spawn a shell for one pane. Output and exit are pushed to that pane (tagged
 * with its paneId) on the owning renderer. Safe to call again for the same
 * paneId (e.g. after a dev reload) — any existing pty for it is killed first.
 */
export function spawnPty(
  paneId: string,
  contents: WebContents,
  cols = DEFAULT_COLS,
  rows = DEFAULT_ROWS,
  shellOverride?: string,
  shortcuts: Shortcut[] = [],
): void {
  killPty(paneId);

  const file = resolveShellExecutable(shellOverride);
  const proc = pty.spawn(file, buildShellArgs(file, shortcuts), {
    name: 'xterm-256color',
    cols: cols > 0 ? cols : DEFAULT_COLS,
    rows: rows > 0 ? rows : DEFAULT_ROWS,
    cwd: os.homedir(),
    env: process.env as Record<string, string>,
  });

  ptys.set(paneId, { proc, wcId: contents.id });

  proc.onData((data) => {
    if (!contents.isDestroyed()) contents.send(IPC.PTY_DATA, { paneId, data });
  });

  proc.onExit(({ exitCode }) => {
    // kill() is asynchronous, so a pty killed during respawn/reload fires its
    // exit on a later tick — by which point a replacement may already own this
    // paneId's map slot. Only the currently-mapped pty may act on its own exit.
    if (ptys.get(paneId)?.proc !== proc) return;
    ptys.delete(paneId);
    if (!contents.isDestroyed()) contents.send(IPC.PTY_EXIT, { paneId, code: exitCode });
  });
}

export function writeToPty(paneId: string, data: string): void {
  ptys.get(paneId)?.proc.write(data);
}

export function resizePty(paneId: string, cols: number, rows: number): void {
  const entry = ptys.get(paneId);
  if (!entry) return;
  if (cols > 0 && rows > 0) {
    try {
      entry.proc.resize(cols, rows);
    } catch {
      // node-pty can throw transiently mid-teardown; the next resize corrects it.
    }
  }
}

export function killPty(paneId: string): void {
  const entry = ptys.get(paneId);
  if (!entry) return;
  try {
    entry.proc.kill();
  } catch {
    // already gone
  }
  ptys.delete(paneId);
}

/** Reap every shell owned by a window (call when its WebContents is destroyed). */
export function killPtysForContents(wcId: number): void {
  for (const [paneId, entry] of ptys) {
    if (entry.wcId !== wcId) continue;
    try {
      entry.proc.kill();
    } catch {
      // already gone
    }
    ptys.delete(paneId);
  }
}
