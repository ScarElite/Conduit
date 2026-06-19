import { useEffect, useReducer, useRef, useState } from 'react';
import { Terminal as XTerm, type ITheme, type IMarker } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { ImageOverlay, type OverlayImage } from './ImageOverlay';

/**
 * The load-bearing contract. Every host (the standalone Conduit app now, V's
 * Command Hub later) implements this against its own node-pty. The component
 * only ever calls these methods — it has no idea what's behind them and never
 * imports `electron` or `node-pty`.
 */
export interface PtyApi {
  onData(cb: (chunk: string) => void): () => void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onExit?(cb: (code: number) => void): () => void;
  kill?(): void;
}

export interface TerminalProps {
  /** Required — the pty contract above. */
  ptyApi: PtyApi;
  /** xterm ITheme — reassign at runtime to recolor live. */
  theme: ITheme;
  fontFamily?: string;
  fontSize?: number;
  /** OSC title pushed by the shell. */
  onTitle?: (title: string) => void;

  // ---- Optional Conduit feature hooks (a minimal host may omit all of these) ----
  /** If provided, pasting at a shell prompt shows the clipboard image inline. */
  getClipboardImage?: () => Promise<string | null>;
  /** If provided, pasting while a full-screen app runs feeds it the image as a file path. */
  saveClipboardImageToFile?: () => Promise<string | null>;
  /** Right-click copy: copies the selection. Falls back to navigator.clipboard if omitted. */
  copyText?: (text: string) => void;
  /** Right-click paste: reads clipboard text. Falls back to navigator.clipboard if omitted. */
  readClipboardText?: () => Promise<string | null>;
  /** OSC 133 command-finished signal (exit code + duration in ms). */
  onCommandFinished?: (exitCode: number, durationMs: number) => void;
  /** Terminal bell. */
  onBell?: () => void;
}

interface PastedImage {
  id: string;
  url: string;
  /** Live xterm marker tracking the cursor line across scrollback trims. */
  marker: IMarker | undefined;
  /** Fallback absolute line (used if no marker could be registered). */
  line: number;
}

const DEFAULT_FONT = 'Consolas, ui-monospace, monospace';
const MAX_PASTED_IMAGES = 24;

export function Terminal(props: TerminalProps) {
  const { ptyApi, theme, fontFamily = DEFAULT_FONT, fontSize = 14 } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  // Keep the latest props in refs so the heavy xterm setup effect can run once
  // while still seeing current callbacks/theme.
  const propsRef = useRef(props);
  propsRef.current = props;

  const [pastedImages, setPastedImages] = useState<PastedImage[]>([]);
  const [cellHeight, setCellHeight] = useState(0);
  const [, bumpTick] = useReducer((n: number) => n + 1, 0);

  // ---- one-time terminal setup ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new XTerm({
      theme: propsRef.current.theme,
      fontFamily: propsRef.current.fontFamily ?? DEFAULT_FONT,
      fontSize: propsRef.current.fontSize ?? 14,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      drawBoldTextInBrightColors: true,
    });
    termRef.current = term;

    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(container);

    // GPU renderer with graceful fallback to the DOM renderer on context loss.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // WebGL2 unavailable — xterm falls back to its DOM renderer automatically.
    }

    try {
      fit.fit();
    } catch {
      /* container not laid out yet */
    }

    let rafTick = 0;
    // Heuristic for "is the bare shell prompt focused?" — true right after an
    // OSC 133 prompt-start marker, false once the user submits a line (so a
    // foreground app like Claude Code is running). Routes image paste.
    let atShellPrompt = true;
    const scheduleTick = () => {
      if (rafTick) return;
      rafTick = requestAnimationFrame(() => {
        rafTick = 0;
        if (!termRef.current) return;
        bumpTick();
      });
    };

    const updateCellHeight = () => {
      const screen = container.querySelector('.xterm-screen') as HTMLElement | null;
      if (screen && term.rows > 0) {
        const h = screen.clientHeight / term.rows;
        if (h > 0) setCellHeight(h);
      }
    };

    const emitImage = (url: string) => {
      const buf = term.buffer.active;
      const line = buf.baseY + buf.cursorY;
      const marker = term.registerMarker(0); // tracks the line across trims
      const id = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      setPastedImages((imgs) => {
        const next = [...imgs, { id, url, marker, line }];
        if (next.length <= MAX_PASTED_IMAGES) return next;
        const overflow = next.length - MAX_PASTED_IMAGES;
        next.slice(0, overflow).forEach((img) => img.marker?.dispose());
        return next.slice(overflow);
      });
      scheduleTick();
    };

    // ---- pty <-> terminal wiring ----
    const offData = ptyApi.onData((d) => term.write(d));
    const dataDisp = term.onData((d) => {
      if (d === '\r') atShellPrompt = false; // a line was submitted
      ptyApi.write(d);
    });
    const binaryDisp = term.onBinary((d) => ptyApi.write(d));
    const offExit = ptyApi.onExit?.((code) => {
      term.write(`\r\n\x1b[2m[process exited with code ${code}]\x1b[0m\r\n`);
    });

    // Subscribe to output BEFORE this first resize, which lazily spawns the pty
    // in the standalone host — so no initial prompt bytes are lost.
    ptyApi.resize(term.cols, term.rows);

    // ---- terminal events ----
    const titleDisp = term.onTitleChange((t) => propsRef.current.onTitle?.(t));
    const bellDisp = term.onBell(() => propsRef.current.onBell?.());
    const scrollDisp = term.onScroll(() => scheduleTick());
    const renderDisp = term.onRender(() => scheduleTick());

    // OSC 133 shell integration: 133;D;<exit>;<durationMs> => command finished.
    const oscDisp = term.parser.registerOscHandler(133, (data) => {
      const parts = data.split(';');
      if (parts[0] === 'A') {
        atShellPrompt = true; // shell is showing a fresh prompt
      } else if (parts[0] === 'D') {
        const exit = parseInt(parts[1] ?? '0', 10) || 0;
        const dur = parseInt(parts[2] ?? '0', 10) || 0;
        propsRef.current.onCommandFinished?.(exit, dur);
      }
      return true; // consume — never render as text
    });

    // ---- image paste: intercept Ctrl+V and read the OS clipboard via the host.
    // clipboard.readImage() in main reliably reads Snipping Tool / browser bitmaps;
    // the DOM clipboardData often doesn't surface them. Text paste is left to xterm.
    term.attachCustomKeyEventHandler((e) => {
      if (
        e.type === 'keydown' &&
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        (e.key === 'v' || e.key === 'V')
      ) {
        if (!atShellPrompt) {
          // A foreground app (e.g. Claude Code) is running — feed it the pasted
          // image as a file path it auto-detects as an image. (Claude Code's own
          // Windows clipboard paste is currently unreliable.)
          const save = propsRef.current.saveClipboardImageToFile;
          if (save) {
            void save()
              .then((p) => {
                if (p) ptyApi.write(p + ' ');
              })
              .catch(() => undefined);
          }
        } else {
          // At a shell prompt — show the image inline.
          const getImage = propsRef.current.getClipboardImage;
          if (getImage) {
            void getImage()
              .then((url) => {
                if (url) emitImage(url);
              })
              .catch(() => undefined);
          }
        }
      }
      return true; // always let xterm process the key (text paste still works)
    });

    // ---- right-click copy/paste (console/PuTTY style): right-clicking a
    // selection copies it (then clears it, so the next right-click pastes);
    // right-clicking with no selection pastes the clipboard into the terminal.
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault(); // suppress the native browser menu
      const selection = term.getSelection();
      if (selection) {
        const copy = propsRef.current.copyText;
        if (copy) copy(selection);
        else void navigator.clipboard?.writeText(selection).catch(() => undefined);
        term.clearSelection();
      } else {
        const paste = (text: string | null) => {
          if (text) term.paste(text); // honors bracketed-paste mode
        };
        const read = propsRef.current.readClipboardText;
        if (read) void read().then(paste).catch(() => undefined);
        else void navigator.clipboard?.readText().then(paste).catch(() => undefined);
      }
    };
    container.addEventListener('contextmenu', onContextMenu);

    let roRaf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(roRaf);
      roRaf = requestAnimationFrame(() => {
        if (!termRef.current) return; // disposed before this frame ran
        try {
          fit.fit();
        } catch {
          /* ignore */
        }
        ptyApi.resize(term.cols, term.rows);
        updateCellHeight();
        scheduleTick();
      });
    });
    ro.observe(container);

    updateCellHeight();
    term.focus();

    return () => {
      cancelAnimationFrame(rafTick);
      cancelAnimationFrame(roRaf);
      container.removeEventListener('contextmenu', onContextMenu);
      ro.disconnect();
      offData();
      offExit?.();
      dataDisp.dispose();
      binaryDisp.dispose();
      titleDisp.dispose();
      bellDisp.dispose();
      scrollDisp.dispose();
      renderDisp.dispose();
      oscDisp.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // Intentionally run once: latest props are read via propsRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- live theme / font updates ----
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = theme;
    term.options.fontFamily = fontFamily;
    term.options.fontSize = fontSize;
    try {
      fitRef.current?.fit();
    } catch {
      /* ignore */
    }
    // Read ptyApi via propsRef so a host with a referentially-unstable PtyApi
    // doesn't re-run this effect every render.
    propsRef.current.ptyApi.resize(term.cols, term.rows);
    const screen = containerRef.current?.querySelector('.xterm-screen') as HTMLElement | null;
    if (screen && term.rows > 0) setCellHeight(screen.clientHeight / term.rows);
  }, [theme, fontFamily, fontSize]);

  // ---- compute overlay image positions for the current viewport ----
  const term = termRef.current;
  const containerWidth = containerRef.current?.clientWidth ?? 800;
  const overlayImages: OverlayImage[] =
    term && cellHeight > 0
      ? pastedImages.map((p) => {
          const buf = term.buffer.active;
          // marker.line stays in the buffer's current coordinate space (xterm
          // decrements it as scrollback is trimmed); -1 means it trimmed away.
          const markerLine = p.marker ? p.marker.line : p.line;
          const line = p.marker && p.marker.line < 0 ? -1 : markerLine;
          const rowsFromTop = line - buf.viewportY;
          const visible = line >= 0 && rowsFromTop > -60 && rowsFromTop < term.rows + 2;
          return {
            id: p.id,
            url: p.url,
            topPx: rowsFromTop * cellHeight + 2,
            leftPx: 12,
            maxWidthPx: Math.max(140, containerWidth - 64),
            visible,
          };
        })
      : [];

  const removeImage = (id: string) =>
    setPastedImages((imgs) => {
      imgs.find((i) => i.id === id)?.marker?.dispose();
      return imgs.filter((i) => i.id !== id);
    });

  return (
    <div className="terminal-host">
      <div className="terminal-mount" ref={containerRef} />
      <ImageOverlay images={overlayImages} onRemove={removeImage} />
    </div>
  );
}
