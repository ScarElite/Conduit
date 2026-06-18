import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ShellIntegrationResult } from '../shared/types';

const execFileAsync = promisify(execFile);

const START_MARKER = '# >>> Conduit shell integration >>>';
const END_MARKER = '# <<< Conduit shell integration <<<';

// The body installed into the user's PowerShell $PROFILE. It wraps the existing
// prompt (preserving it) and emits OSC 133 markers the renderer parses:
//   133;A            -> prompt start
//   133;D;<exit>;<ms> -> command finished (exit code + Conduit duration extension)
// The duration comes straight from PowerShell's own command history timing, so
// the renderer can ding only for commands that ran longer than a threshold.
const INTEGRATION_BODY = String.raw`# Conduit OSC 133 shell integration (command-completion markers + timing).
if ((Test-Path Function:\prompt) -and -not (Test-Path Function:\__Conduit_OriginalPrompt)) {
  Rename-Item Function:\prompt __Conduit_OriginalPrompt -ErrorAction SilentlyContinue
}
function Global:prompt {
  $exit = $LASTEXITCODE
  $esc = [char]27
  $durMs = 0
  $h = Get-History -Count 1 -ErrorAction SilentlyContinue
  if ($h -and $h.EndExecutionTime -and $h.StartExecutionTime) {
    $durMs = [int](($h.EndExecutionTime - $h.StartExecutionTime).TotalMilliseconds)
  }
  [Console]::Write("$esc]133;D;$exit;$durMs$esc\")
  [Console]::Write("$esc]133;A$esc\")
  if (Test-Path Function:\__Conduit_OriginalPrompt) {
    return (& __Conduit_OriginalPrompt)
  }
  return "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) "
}`;

async function getProfilePath(): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', '$PROFILE.CurrentUserCurrentHost'],
    { windowsHide: true },
  );
  return stdout.trim();
}

/**
 * Append (or refresh) the Conduit OSC 133 block in the user's PowerShell
 * profile. Idempotent: re-running replaces the existing guarded block rather
 * than duplicating it.
 */
export async function installShellIntegration(): Promise<ShellIntegrationResult> {
  try {
    const profilePath = await getProfilePath();
    if (!profilePath) {
      return { ok: false, profilePath: '', alreadyInstalled: false, error: 'Could not resolve $PROFILE path.' };
    }

    await fs.mkdir(path.dirname(profilePath), { recursive: true });

    let existing = '';
    try {
      existing = await fs.readFile(profilePath, 'utf8');
    } catch {
      // Profile doesn't exist yet — we'll create it.
    }

    const block = `${START_MARKER}\n${INTEGRATION_BODY}\n${END_MARKER}\n`;
    const startIdx = existing.indexOf(START_MARKER);
    const endIdx = existing.indexOf(END_MARKER);

    let next: string;
    let alreadyInstalled = false;
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      alreadyInstalled = true;
      const after = existing.slice(endIdx + END_MARKER.length).replace(/^\r?\n/, '');
      next = existing.slice(0, startIdx) + block + after;
    } else {
      const needsGap = existing.length > 0;
      const prefix = existing.length > 0 && !existing.endsWith('\n') ? existing + '\n' : existing;
      next = prefix + (needsGap ? '\n' : '') + block;
    }

    await fs.writeFile(profilePath, next, 'utf8');
    return { ok: true, profilePath, alreadyInstalled };
  } catch (err) {
    return {
      ok: false,
      profilePath: '',
      alreadyInstalled: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
