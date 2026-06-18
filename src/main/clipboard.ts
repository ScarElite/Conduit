import { clipboard } from 'electron';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

/**
 * Returns a base64 PNG data URL for whatever bitmap is on the clipboard
 * (e.g. a Snipping Tool screenshot), or null when the clipboard holds no image.
 * Used to render the inline image overlay at a shell prompt.
 */
export function getClipboardImage(): string | null {
  const img = clipboard.readImage();
  if (img.isEmpty()) return null;
  return img.toDataURL();
}

/**
 * Saves the clipboard image to a temp PNG and returns its path, or null when the
 * clipboard holds no image. Used to hand a pasted image to a full-screen app
 * running in the terminal (e.g. Claude Code) as a file path it can read.
 */
export async function saveClipboardImageToTemp(): Promise<string | null> {
  const img = clipboard.readImage();
  if (img.isEmpty()) return null;
  const file = path.join(os.tmpdir(), `conduit-paste-${Date.now()}.png`);
  await fs.writeFile(file, img.toPNG());
  return file;
}
