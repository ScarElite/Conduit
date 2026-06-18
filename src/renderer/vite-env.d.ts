/// <reference types="vite/client" />
import type { TermBridge } from '../shared/types';

declare global {
  interface Window {
    /** The narrow bridge exposed by preload via contextBridge. */
    term: TermBridge;
  }
}

// Audio asset imports (e.g. the built-in ding) resolve to a URL string via the
// `*.wav` declaration provided by vite/client.

export {};
