import { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal, type PtyApi } from './Terminal';
import { SettingsPanel } from './SettingsPanel';
import { applyChrome, applyGlow, findTheme, PRESETS } from './themes';
import type { Settings, Theme } from '../shared/types';
import { DING_DATA_URL } from './ding-sound';

// Claude Code (and many CLIs) show a braille spinner in the window title while
// working and a non-spinner marker (e.g. ✳) when idle. A spinner -> idle title
// transition is a reliable "task/response finished" signal, independent of focus
// and scoped to this terminal — used to ding when Claude finishes a response.
function isWorkingTitle(t: string): boolean {
  const s = t.replace(/^\s+/, '');
  if (!s) return false;
  const c = s.codePointAt(0) ?? 0;
  return c >= 0x2800 && c <= 0x28ff; // braille pattern block = spinner
}

function uniqueName(base: string, existing: Theme[]): string {
  const names = new Set(existing.map((t) => t.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i += 1;
  return `${base} ${i}`;
}

function TitleBar({
  title,
  onToggleSettings,
}: {
  title: string;
  onToggleSettings: () => void;
}) {
  return (
    <div className="titlebar">
      <div className="titlebar-drag">
        <span className="titlebar-logo">▮</span>
        <span className="titlebar-title">{title || 'Conduit'}</span>
      </div>
      <div className="titlebar-actions">
        <button className="tb-btn" title="Settings" onClick={onToggleSettings}>
          ⚙
        </button>
        <span className="tb-sep" />
        <button
          className="tb-win"
          title="Minimize"
          onClick={() => window.term.windowControl('minimize')}
        >
          ─
        </button>
        <button
          className="tb-win"
          title="Maximize"
          onClick={() => window.term.windowControl('maximize')}
        >
          ▢
        </button>
        <button
          className="tb-win tb-close"
          title="Close"
          onClick={() => window.term.windowControl('close')}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [title, setTitle] = useState('Conduit');
  const lastDing = useRef(0);
  const wasWorking = useRef(false);

  // Load persisted settings before first paint of the chrome.
  useEffect(() => {
    window.term.loadSettings().then(setSettings);
  }, []);

  const activeTheme = settings
    ? findTheme(settings.activeTheme, settings.customThemes)
    : PRESETS[0];

  // Layer B: push chrome colors + HUD glow onto the live CSS variables.
  useEffect(() => {
    applyChrome(activeTheme.chrome);
    applyGlow(activeTheme.glowStrength);
  }, [activeTheme]);

  // Window opacity follows the setting.
  useEffect(() => {
    if (settings) window.term.setOpacity(settings.windowOpacity);
  }, [settings?.windowOpacity]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable PtyApi adapter over the preload bridge. The pty is spawned lazily on
  // the first resize (which carries the real initial size).
  const ptyApi = useMemo<PtyApi>(() => {
    let started = false;
    return {
      onData: (cb) => window.term.onData(cb),
      onExit: (cb) => window.term.onExit(cb),
      write: (d) => window.term.write(d),
      resize: (cols, rows) => {
        if (!started) {
          started = true;
          window.term.start(cols, rows);
        } else {
          window.term.resize(cols, rows);
        }
      },
    };
  }, []);

  function playDing(force = false) {
    const now = Date.now();
    if (!force && now - lastDing.current < 250) return;
    lastDing.current = now;
    const url =
      !settings || settings.dingSound === 'builtin' ? DING_DATA_URL : settings.dingSound;
    try {
      const audio = new Audio(url);
      audio.volume = 0.6;
      void audio.play().catch(() => undefined);
    } catch {
      /* autoplay blocked or bad url */
    }
  }

  function persist(next: Settings) {
    setSettings(next);
    void window.term.saveSettings(next);
  }

  function update(patch: Partial<Settings>) {
    if (!settings) return;
    persist({ ...settings, ...patch });
  }

  // Edit the active theme live. Editing a preset auto-forks a custom copy so
  // presets stay pristine and the edit persists.
  function editTheme(updated: Theme) {
    if (!settings) return;
    const isPreset = PRESETS.some((p) => p.name === settings.activeTheme);
    if (isPreset) {
      const forkName = uniqueName(`${settings.activeTheme} Custom`, settings.customThemes);
      persist({
        ...settings,
        customThemes: [...settings.customThemes, { ...updated, name: forkName }],
        activeTheme: forkName,
      });
    } else {
      persist({
        ...settings,
        customThemes: settings.customThemes.map((t) =>
          t.name === settings.activeTheme ? { ...updated, name: settings.activeTheme } : t,
        ),
      });
    }
  }

  function saveAsTheme(name: string) {
    if (!settings) return;
    const base = findTheme(settings.activeTheme, settings.customThemes);
    const nm = uniqueName(name.trim() || 'My Theme', settings.customThemes);
    persist({
      ...settings,
      customThemes: [...settings.customThemes, { ...base, name: nm }],
      activeTheme: nm,
    });
  }

  function deleteTheme(name: string) {
    if (!settings) return;
    const customThemes = settings.customThemes.filter((t) => t.name !== name);
    const activeThemeName =
      settings.activeTheme === name ? PRESETS[0].name : settings.activeTheme;
    persist({ ...settings, customThemes, activeTheme: activeThemeName });
  }

  if (!settings) {
    return <div className="loading">Loading…</div>;
  }

  // Font zoom is a persisted offset on top of the active theme's size, clamped to
  // a sane range. The terminal emits +/-/reset intents; we own the persistence.
  const FONT_MIN = 6;
  const FONT_MAX = 40;
  const baseFontSize = activeTheme.font.size;
  const fontSizeOffset = settings.fontSizeOffset ?? 0;
  const effectiveFontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, baseFontSize + fontSizeOffset));

  function zoomFont(delta: number) {
    const next = Math.min(
      FONT_MAX - baseFontSize,
      Math.max(FONT_MIN - baseFontSize, fontSizeOffset + delta),
    );
    if (next !== fontSizeOffset) update({ fontSizeOffset: next });
  }

  return (
    <div className="app">
      <TitleBar title={title} onToggleSettings={() => setPanelOpen((o) => !o)} />
      <div className="terminal-area">
        <Terminal
          ptyApi={ptyApi}
          theme={activeTheme.xterm}
          fontFamily={activeTheme.font.family}
          fontSize={effectiveFontSize}
          onZoom={zoomFont}
          onResetZoom={() => update({ fontSizeOffset: 0 })}
          onTitle={(t) => {
            setTitle(t);
            // Ding when a foreground app (e.g. Claude Code) goes spinner -> idle.
            const working = isWorkingTitle(t);
            if (wasWorking.current && !working && settings.dingEnabled) playDing();
            wasWorking.current = working;
          }}
          getClipboardImage={() => window.term.getClipboardImage()}
          saveClipboardImageToFile={() => window.term.saveClipboardImageToFile()}
          copyText={(t) => window.term.copyText(t)}
          readClipboardText={() => window.term.readClipboardText()}
          onCommandFinished={(_exit, durationMs) => {
            if (settings.dingEnabled && durationMs >= settings.dingThresholdMs) {
              playDing();
            }
          }}
          onBell={() => {
            if (settings.dingEnabled) playDing();
          }}
        />
      </div>
      <SettingsPanel
        open={panelOpen}
        settings={settings}
        activeTheme={activeTheme}
        onClose={() => setPanelOpen(false)}
        onChangeSettings={update}
        onChangeTheme={(name) => update({ activeTheme: name })}
        onEditTheme={editTheme}
        onSaveAsTheme={saveAsTheme}
        onDeleteTheme={deleteTheme}
        onTestSound={() => playDing(true)}
      />
    </div>
  );
}
