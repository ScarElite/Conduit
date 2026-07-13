import { useEffect, useReducer, useRef, useState } from 'react';
import { Terminal as XTerm, type ITheme, type IMarker } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
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

/**
 * A Conduit-level command shown in the slash command bar. The host supplies
 * host-specific commands (theme switch, open settings, …); the terminal adds
 * its own built-ins (clear, …). `name` excludes the leading slash.
 */
export interface ConduitCommand {
  name: string;
  description: string;
  run: () => void;
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
  /** Click on a URL: opens it (e.g. in the default browser). Falls back to window.open. */
  openLink?: (url: string) => void;
  /** OSC 133 command-finished signal (exit code + duration in ms). */
  onCommandFinished?: (exitCode: number, durationMs: number) => void;
  /** Terminal bell. */
  onBell?: () => void;
  /** Font-zoom intent (Ctrl +/-, Ctrl+scroll). delta is +1 / -1 steps; the host persists the size. */
  onZoom?: (delta: number) => void;
  /** Reset font zoom (Ctrl+0). */
  onResetZoom?: () => void;
  /** Host-provided commands for the slash command bar (merged with built-ins like /clear). */
  commands?: ConduitCommand[];
  /** True when this pane is the visible/active tab — triggers a refit + focus. */
  active?: boolean;
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

// Warm "search highlight" decoration colors — readable on Conduit's dark themes
// and distinct from the (often green) foreground text. Active match is brighter.
const SEARCH_DECORATIONS = {
  matchBackground: 'rgba(255, 221, 87, 0.28)',
  matchBorder: 'rgba(255, 221, 87, 0.5)',
  matchOverviewRuler: '#ffdd57',
  activeMatchBackground: 'rgba(255, 162, 0, 0.55)',
  activeMatchBorder: '#ffa200',
  activeMatchColorOverviewRuler: '#ffa200',
};

export function Terminal(props: TerminalProps) {
  const { ptyApi, theme, fontFamily = DEFAULT_FONT, fontSize = 14, active = false } = props;

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

  // ---- find-in-terminal (Ctrl+F) ----
  const searchRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState({ index: -1, count: 0 });
  // Latest query for the open-effect's initial search (avoids a stale closure).
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;

  // ---- slash command bar (type "/" at an empty prompt, or Ctrl+Shift+P) ----
  const cmdInputRef = useRef<HTMLInputElement>(null);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState('');
  const [cmdIndex, setCmdIndex] = useState(0);
  // "Is the bare shell prompt focused?" — true right after an OSC 133 prompt-start,
  // false once a line is submitted (a foreground app like Claude Code is running).
  // Routes image paste, and gates the command bar + its post-run echo.
  const atShellPromptRef = useRef(true);
  // True only at a fresh, empty shell prompt — gates the bare-"/" trigger so it
  // never fires mid-line (where "/" is a real path/argument character).
  const freshPromptRef = useRef(true);

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
    // Link activation must go through the host: the addon's default window.open
    // is denied by main's setWindowOpenHandler, so a bare WebLinksAddon() makes
    // link clicks silently do nothing.
    term.loadAddon(
      new WebLinksAddon((_e, uri) => {
        const open = propsRef.current.openLink;
        if (open) open(uri);
        else window.open(uri, '_blank', 'noopener');
      }),
    );
    term.open(container);

    // GPU renderer with graceful fallback to the DOM renderer on context loss.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // WebGL2 unavailable — xterm falls back to its DOM renderer automatically.
    }

    // Find-in-terminal: the addon does the searching + match decorations; the
    // small overlay bar (rendered below) drives it.
    const search = new SearchAddon();
    term.loadAddon(search);
    searchRef.current = search;
    const searchResultsDisp = search.onDidChangeResults((r) =>
      setSearchResults({ index: r.resultIndex, count: r.resultCount }),
    );

    try {
      fit.fit();
    } catch {
      /* container not laid out yet */
    }

    let rafTick = 0;
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
      if (d === '\r') atShellPromptRef.current = false; // a line was submitted
      // Clear "fresh prompt" only when a PRINTABLE character is typed (adds
      // content to the line). Ignore escape sequences — arrow keys, and crucially
      // the focus-report bytes xterm emits when the command/search bar steals and
      // returns focus, which would otherwise wrongly mark the prompt non-fresh and
      // stop the next "/" from opening the command bar.
      const c0 = d.charCodeAt(0);
      if (c0 >= 0x20 && c0 !== 0x7f) freshPromptRef.current = false;
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
        atShellPromptRef.current = true; // shell is showing a fresh prompt
        freshPromptRef.current = true; // …and nothing typed on it yet
      } else if (parts[0] === 'D') {
        const exit = parseInt(parts[1] ?? '0', 10) || 0;
        const dur = parseInt(parts[2] ?? '0', 10) || 0;
        propsRef.current.onCommandFinished?.(exit, dur);
      }
      return true; // consume — never render as text
    });

    // Open the find bar; prefill from a single-line selection if present.
    const openSearch = () => {
      const sel = term.getSelection();
      if (sel && !sel.includes('\n')) setSearchQuery(sel);
      setCmdOpen(false);
      setSearchOpen(true);
    };

    // Open the slash command bar.
    const openCommandBar = () => {
      setSearchOpen(false);
      setCmdQuery('');
      setCmdIndex(0);
      setCmdOpen(true);
    };

    // ---- keyboard shortcuts. Ctrl+F = find, Ctrl +/-/0 = font zoom, Ctrl+V =
    // clipboard paste (text, or image when there's no text). clipboard.readImage()
    // in main reliably reads Snipping Tool / browser bitmaps the DOM often won't
    // surface.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;

      // "/" at an empty fresh prompt opens the Conduit command bar instead of
      // going to the shell. Anywhere else (mid-line, or an app running) it's a
      // normal slash.
      if (
        e.key === '/' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        atShellPromptRef.current &&
        freshPromptRef.current
      ) {
        // preventDefault so the "/" isn't also typed into xterm's hidden textarea
        // (returning false stops xterm's own handling but not that insertion) —
        // otherwise a stray "/" reaches the shell and clears the fresh-prompt flag.
        e.preventDefault();
        openCommandBar();
        return false;
      }

      const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
      if (!mod) return true;

      // Ctrl+Shift+P — open the command bar (palette-style)
      if (e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        openCommandBar();
        return false;
      }

      // Ctrl+F — find in terminal
      if (!e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        openSearch();
        return false; // don't forward to the shell
      }
      // Ctrl +/-/0 — font zoom (the host persists the new size). preventDefault
      // so the keypress can't also trigger any browser-level page zoom.
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        propsRef.current.onZoom?.(1);
        return false;
      }
      if (e.key === '-') {
        e.preventDefault();
        propsRef.current.onZoom?.(-1);
        return false;
      }
      if (e.key === '0') {
        e.preventDefault();
        propsRef.current.onResetZoom?.();
        return false;
      }

      // Ctrl+V — clipboard paste. Text pastes into the terminal; when the
      // clipboard holds no text, an image routes by shell-prompt state. xterm
      // never pastes on Ctrl+V itself (it would encode it as 0x16 for the
      // shell), so the whole paste is handled here.
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        const read = propsRef.current.readClipboardText;
        const textRead: Promise<string | null> = read
          ? read().catch(() => null)
          : navigator.clipboard?.readText().catch(() => null) ??
            Promise.resolve(null);
        void textRead.then((text) => {
          if (text) {
            term.paste(text); // honors bracketed-paste mode
            return;
          }
          if (!atShellPromptRef.current) {
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
        });
        return false; // fully handled — don't let xterm send 0x16 to the shell
      }
      return true;
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

    // Ctrl + mouse wheel = font zoom (capture phase so xterm doesn't scroll).
    // Accumulate raw deltas so one wheel notch ≈ one step and a fast scroll or
    // trackpad burst can't slam the font straight to the size limit.
    let wheelAccum = 0;
    const WHEEL_STEP = 100; // ~ one mouse-wheel notch of pixel delta
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault(); // also blocks Chromium's own Ctrl+wheel page zoom
      e.stopPropagation();
      wheelAccum += e.deltaMode === 1 ? e.deltaY * WHEEL_STEP : e.deltaY;
      while (wheelAccum <= -WHEEL_STEP) {
        propsRef.current.onZoom?.(1);
        wheelAccum += WHEEL_STEP;
      }
      while (wheelAccum >= WHEEL_STEP) {
        propsRef.current.onZoom?.(-1);
        wheelAccum -= WHEEL_STEP;
      }
    };
    container.addEventListener('wheel', onWheel, { passive: false, capture: true });

    let roRaf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(roRaf);
      roRaf = requestAnimationFrame(() => {
        if (!termRef.current) return; // disposed before this frame ran
        // Never fit a hidden pane. An inactive tab is display:none → 0 size, and
        // fit() doesn't bail at 0 — it clamps to xterm's 2-column minimum and
        // resizes the pty, which corrupts any TUI (e.g. Claude Code) running in
        // the background tab. Skip until it's visible again.
        if (container.clientWidth === 0 || container.clientHeight === 0) return;
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
      container.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions);
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
      searchResultsDisp.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
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
    // Only refit/resize when visible — fitting a hidden pane (inactive tab, 0 size)
    // would shrink the pty to xterm's 2-col minimum and corrupt it. The pane
    // refits when it next becomes active.
    const el = containerRef.current;
    if (el && el.clientWidth > 0 && el.clientHeight > 0) {
      try {
        fitRef.current?.fit();
      } catch {
        /* ignore */
      }
      // Read ptyApi via propsRef so a host with a referentially-unstable PtyApi
      // doesn't re-run this effect every render.
      propsRef.current.ptyApi.resize(term.cols, term.rows);
      const screen = el.querySelector('.xterm-screen') as HTMLElement | null;
      if (screen && term.rows > 0) setCellHeight(screen.clientHeight / term.rows);
    }
  }, [theme, fontFamily, fontSize]);

  // When this pane becomes the active tab it may have just been un-hidden
  // (display:none → real size). Refit to the now-correct size, sync the pty, and
  // take keyboard focus.
  useEffect(() => {
    if (!active) return;
    // Defer a frame so the pane's display:block layout is settled before fitting
    // (and skip if it's somehow still 0 — never fit to the 2-col minimum).
    const raf = requestAnimationFrame(() => {
      const term = termRef.current;
      const el = containerRef.current;
      if (!term || !el || el.clientWidth === 0 || el.clientHeight === 0) return;
      try {
        fitRef.current?.fit();
      } catch {
        /* ignore */
      }
      propsRef.current.ptyApi.resize(term.cols, term.rows);
      term.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [active]);

  // ---- find bar actions ----
  const runSearch = (query: string, mode: 'next' | 'prev' | 'incremental') => {
    const addon = searchRef.current;
    if (!addon) return;
    if (!query) {
      addon.clearDecorations();
      setSearchResults({ index: -1, count: 0 });
      return;
    }
    if (mode === 'prev') addon.findPrevious(query, { decorations: SEARCH_DECORATIONS });
    else
      addon.findNext(query, {
        decorations: SEARCH_DECORATIONS,
        incremental: mode === 'incremental',
      });
  };

  const closeSearch = () => {
    searchRef.current?.clearDecorations();
    setSearchOpen(false);
    setSearchResults({ index: -1, count: 0 });
    termRef.current?.focus();
  };

  // On open: focus + select the input, and search any prefilled (selection) text.
  useEffect(() => {
    if (!searchOpen) return;
    const input = searchInputRef.current;
    input?.focus();
    input?.select();
    const q = searchQueryRef.current;
    if (q) searchRef.current?.findNext(q, { decorations: SEARCH_DECORATIONS, incremental: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen]);

  // ---- slash command bar actions ----
  // Terminal-native built-ins merged with the host's commands (theme, settings…).
  const allCommands: ConduitCommand[] = [
    {
      name: 'clear',
      description: 'Clear the terminal buffer and scrollback',
      run: () => termRef.current?.clear(),
    },
    {
      name: 'commands',
      description: 'Show every available Conduit command',
      run: () => {
        setCmdQuery('');
        setCmdIndex(0);
      },
    },
    ...(props.commands ?? []),
  ];
  const cmdFiltered = cmdQuery
    ? allCommands.filter((c) => c.name.toLowerCase().includes(cmdQuery.toLowerCase()))
    : allCommands;
  const cmdActive = Math.min(cmdIndex, Math.max(0, cmdFiltered.length - 1));

  const closeCommandBar = () => {
    setCmdOpen(false);
    setCmdQuery('');
    setCmdIndex(0);
    termRef.current?.focus();
  };

  const runCommand = (c: ConduitCommand | undefined) => {
    if (!c) return;
    c.run();
    // "/commands" just re-lists everything — it isn't a real action.
    if (c.name === 'commands') {
      cmdInputRef.current?.focus();
      return;
    }
    setCmdOpen(false);
    setCmdQuery('');
    setCmdIndex(0);
    // Log what ran onto the shell line (as a no-op "#" comment) and drop to a
    // fresh prompt — leaves a record and frees the line so the next "/" works at
    // once. Only at a real shell prompt (never inject into a running app); and
    // /clear is exempt since its whole purpose is a clean screen.
    if (c.name !== 'clear' && atShellPromptRef.current) {
      ptyApi.write(`# /${c.name}\r`);
    }
    termRef.current?.focus();
  };

  // Focus the command input whenever the bar opens.
  useEffect(() => {
    if (cmdOpen) cmdInputRef.current?.focus();
  }, [cmdOpen]);

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
      {searchOpen && (
        <div className="term-search">
          <input
            ref={searchInputRef}
            className="term-search-input"
            placeholder="Find"
            spellCheck={false}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              runSearch(e.target.value, 'incremental');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                runSearch(searchQuery, e.shiftKey ? 'prev' : 'next');
              } else if (e.key === 'Escape') {
                e.preventDefault();
                closeSearch();
              }
            }}
          />
          <span className="term-search-count">
            {searchQuery
              ? searchResults.count > 0
                ? `${searchResults.index + 1}/${searchResults.count}`
                : 'No results'
              : ''}
          </span>
          <button
            className="term-search-btn"
            title="Previous match (Shift+Enter)"
            onClick={() => runSearch(searchQuery, 'prev')}
          >
            ↑
          </button>
          <button
            className="term-search-btn"
            title="Next match (Enter)"
            onClick={() => runSearch(searchQuery, 'next')}
          >
            ↓
          </button>
          <button className="term-search-btn" title="Close (Esc)" onClick={closeSearch}>
            ✕
          </button>
        </div>
      )}
      {cmdOpen && (
        <div className="term-cmd">
          <div className="term-cmd-field">
            <span className="term-cmd-prefix">/</span>
            <input
              ref={cmdInputRef}
              className="term-cmd-input"
              placeholder="command"
              spellCheck={false}
              value={cmdQuery}
              onChange={(e) => {
                // Strip a leading "/" so typing "/clear" out of habit still matches
                // (the slash is shown as a static prefix, not part of the query).
                setCmdQuery(e.target.value.replace(/^\/+/, ''));
                setCmdIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  runCommand(cmdFiltered[cmdActive]);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  closeCommandBar();
                } else if (e.key === 'Backspace' && cmdQuery === '') {
                  // Backspace past the "/" (nothing else typed) dismisses the bar.
                  e.preventDefault();
                  closeCommandBar();
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setCmdIndex(Math.min(cmdActive + 1, cmdFiltered.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setCmdIndex(Math.max(cmdActive - 1, 0));
                }
              }}
            />
          </div>
          <ul className="term-cmd-list">
            {cmdFiltered.length === 0 ? (
              <li className="term-cmd-empty">No matching command</li>
            ) : (
              cmdFiltered.map((c, i) => (
                <li
                  key={c.name}
                  className={`term-cmd-item${i === cmdActive ? ' active' : ''}`}
                  onMouseEnter={() => setCmdIndex(i)}
                  onMouseDown={(e) => {
                    e.preventDefault(); // keep focus in the input
                    runCommand(c);
                  }}
                >
                  <span className="term-cmd-name">/{c.name}</span>
                  <span className="term-cmd-desc">{c.description}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
