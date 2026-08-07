import * as pty from 'node-pty';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { app, type WebContents } from 'electron';
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
//
// It also carries the shortcut loader. Shortcuts live in a generated .ps1 file
// that the prompt re-sources whenever its timestamp changes, so editing them
// reaches shells that are ALREADY RUNNING — not just newly spawned ones.
function buildPromptSetup(shortcutFile: string): string {
  return String.raw`if ((Test-Path Function:\prompt) -and -not (Test-Path Function:\__Conduit_OriginalPrompt)) {
  Rename-Item Function:\prompt __Conduit_OriginalPrompt -ErrorAction SilentlyContinue
}
$Global:__Conduit_ShortcutFile = ${psLiteral(shortcutFile)}
function Global:__Conduit_LoadShortcuts {
  try {
    $f = Get-Item -LiteralPath $Global:__Conduit_ShortcutFile -ErrorAction Stop
    if ($f.LastWriteTimeUtc -ne $Global:__Conduit_ShortcutStamp) {
      $Global:__Conduit_ShortcutStamp = $f.LastWriteTimeUtc
      . $Global:__Conduit_ShortcutFile
    }
  } catch {
    # no shortcut file yet, or it's mid-rewrite — the next prompt retries
  }
}
function Global:prompt {
  $exit = $LASTEXITCODE
  if ($null -eq $exit) { $exit = 0 }
  __Conduit_LoadShortcuts
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
}

/** PowerShell single-quoted literal — the only quoting that never interpolates. */
function psLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

// A shortcut name becomes a function name, so it has to be one PowerShell can
// call bare — anything else would need call-operator syntax and defeat the point
// of just typing `rf`.
const SHORTCUT_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * Compile the user's shortcuts into a PowerShell script. They become real
 * functions — so they tab-complete, compose, and forward arguments
 * (`rf --continue`) like anything else.
 *
 * A missing folder aborts with a warning instead of running the command in
 * whatever directory the shell happened to be sitting in.
 *
 * The script is DOT-SOURCED FROM INSIDE a function (the prompt's loader), which
 * is why every function declares `Global:` explicitly — without it they would
 * land in the loader's scope and vanish. The preamble removes the previous
 * generation first, so deleting or renaming a shortcut takes effect too.
 */
function buildShortcutScript(shortcuts: Shortcut[]): string {
  const out: string[] = [];
  const names: string[] = [];
  const seen = new Set<string>();
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
    names.push(name);
    out.push(`function Global:${name} {\n${body.join('\n')}\n}`);
  }
  const preamble = String.raw`# Generated by Conduit. Do not edit — rewritten whenever shortcuts change.
if ($Global:__Conduit_ShortcutNames) {
  foreach ($n in $Global:__Conduit_ShortcutNames) {
    if (Test-Path -LiteralPath "Function:\$n") {
      Remove-Item -LiteralPath "Function:\$n" -Force -ErrorAction SilentlyContinue
    }
  }
}
$Global:__Conduit_ShortcutNames = @(${names.map(psLiteral).join(', ')})`;
  return `${preamble}\n${out.join('\n')}\n`;
}

/** Where the generated shortcut script lives (one per user profile). */
export function shortcutFilePath(): string {
  return path.join(app.getPath('userData'), 'conduit-shortcuts.ps1');
}

/**
 * Rewrite the shortcut script. Every live shell picks the change up at its next
 * prompt; new shells source it at startup. Returns the path.
 */
export function syncShortcutFile(shortcuts: Shortcut[]): string {
  const file = shortcutFilePath();
  try {
    // BOM: Windows PowerShell 5.1 reads a BOM-less file as ANSI, which would
    // mangle any non-ASCII character in a folder path.
    writeFileSync(file, `﻿${buildShortcutScript(shortcuts)}`, 'utf8');
  } catch {
    // Best effort — a shell without shortcuts still works fine.
  }
  return file;
}

function buildShellArgs(file: string, shortcutFile: string): string[] {
  if (isPowerShell(file)) {
    // -EncodedCommand avoids all command-line escaping; -NoExit keeps the shell
    // interactive after the setup runs (which produces no visible output).
    const encoded = Buffer.from(buildPromptSetup(shortcutFile), 'utf16le').toString('base64');
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
  // Write the script before spawning so the very first prompt already has them.
  const proc = pty.spawn(file, buildShellArgs(file, syncShortcutFile(shortcuts)), {
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
