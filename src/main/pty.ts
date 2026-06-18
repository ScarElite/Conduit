import * as pty from 'node-pty';
import os from 'node:os';
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

function pickShell(override?: string): { file: string; args: string[] } {
  const file = override && override.trim() ? override.trim() : detectDefaultShell();
  return { file, args: [] };
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

  const { file, args } = pickShell(shellOverride);
  const proc = pty.spawn(file, args, {
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
