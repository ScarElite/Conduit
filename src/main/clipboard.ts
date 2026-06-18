import { clipboard } from 'electron';

/**
 * Returns a base64 PNG data URL for whatever bitmap is on the clipboard
 * (e.g. a Snipping Tool screenshot), or null when the clipboard holds no image.
 */
export function getClipboardImage(): string | null {
  const img = clipboard.readImage();
  if (img.isEmpty()) return null;
  return img.toDataURL();
}
