import { useState } from 'react';
import type { ChromeTheme, Settings, Shortcut, Theme, XtermTheme } from '../shared/types';
import { PRESETS } from './themes';

interface Props {
  open: boolean;
  settings: Settings;
  activeTheme: Theme;
  onClose: () => void;
  onChangeSettings: (patch: Partial<Settings>) => void;
  onChangeTheme: (name: string) => void;
  onEditTheme: (updated: Theme) => void;
  onSaveAsTheme: (name: string) => void;
  onDeleteTheme: (name: string) => void;
  onTestSound: () => void;
}

const XTERM_FIELDS: { key: keyof XtermTheme; label: string }[] = [
  { key: 'foreground', label: 'Foreground (text)' },
  { key: 'background', label: 'Background' },
  { key: 'cursor', label: 'Cursor' },
  { key: 'cursorAccent', label: 'Cursor text' },
  { key: 'selectionBackground', label: 'Selection' },
  { key: 'black', label: 'ANSI Black' },
  { key: 'red', label: 'ANSI Red' },
  { key: 'green', label: 'ANSI Green' },
  { key: 'yellow', label: 'ANSI Yellow' },
  { key: 'blue', label: 'ANSI Blue' },
  { key: 'magenta', label: 'ANSI Magenta' },
  { key: 'cyan', label: 'ANSI Cyan' },
  { key: 'white', label: 'ANSI White' },
  { key: 'brightBlack', label: 'Bright Black' },
  { key: 'brightRed', label: 'Bright Red' },
  { key: 'brightGreen', label: 'Bright Green' },
  { key: 'brightYellow', label: 'Bright Yellow' },
  { key: 'brightBlue', label: 'Bright Blue' },
  { key: 'brightMagenta', label: 'Bright Magenta' },
  { key: 'brightCyan', label: 'Bright Cyan' },
  { key: 'brightWhite', label: 'Bright White' },
];

const CHROME_FIELDS: { key: keyof ChromeTheme; label: string }[] = [
  { key: 'chromeBg', label: 'Window background' },
  { key: 'border', label: 'Border' },
  { key: 'titlebarFg', label: 'Title bar text' },
  { key: 'accent', label: 'Accent' },
  { key: 'panelBg', label: 'Panel background' },
  { key: 'panelFg', label: 'Panel text' },
  { key: 'scrollbar', label: 'Scrollbar' },
];

// Must match SHORTCUT_NAME in src/main/pty.ts — a name that isn't a legal
// PowerShell function name is silently skipped at spawn, so flag it here.
const SHORTCUT_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function shortcutProblem(sc: Shortcut, index: number, all: Shortcut[]): string | null {
  const name = sc.name.trim();
  if (!name) return 'Give it a name to type at the prompt.';
  if (!SHORTCUT_NAME.test(name)) {
    return 'Use letters, digits, _ or - (starting with a letter or _).';
  }
  const dupe = all.some(
    (o, i) => i < index && o.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (dupe) return `Another shortcut is already called “${name}”.`;
  if (!sc.folder.trim() && !sc.command.trim()) return 'Set a folder, a command, or both.';
  return null;
}

function colorInputValue(v: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#000000';
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="color-field">
      <span className="cf-label">{label}</span>
      <span className="cf-inputs">
        <input
          type="color"
          value={colorInputValue(value)}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          type="text"
          className="cf-hex"
          value={value}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      </span>
    </label>
  );
}

export function SettingsPanel(props: Props) {
  const {
    open,
    settings,
    activeTheme,
    onClose,
    onChangeSettings,
    onChangeTheme,
    onEditTheme,
    onSaveAsTheme,
    onDeleteTheme,
    onTestSound,
  } = props;

  const [newThemeName, setNewThemeName] = useState('');

  const isPresetActive = PRESETS.some((p) => p.name === settings.activeTheme);

  const setXterm = (key: keyof XtermTheme, val: string) =>
    onEditTheme({ ...activeTheme, xterm: { ...activeTheme.xterm, [key]: val } });
  const setChrome = (key: keyof ChromeTheme, val: string) =>
    onEditTheme({ ...activeTheme, chrome: { ...activeTheme.chrome, [key]: val } });
  const setFont = (patch: Partial<Theme['font']>) =>
    onEditTheme({ ...activeTheme, font: { ...activeTheme.font, ...patch } });

  const pickSound = async () => {
    const url = await window.term.pickSoundFile();
    if (url) onChangeSettings({ dingSound: url });
  };

  // ---- shortcuts ----
  const shortcuts = settings.shortcuts ?? [];
  const setShortcut = (i: number, patch: Partial<Shortcut>) =>
    onChangeSettings({
      shortcuts: shortcuts.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    });
  const addShortcut = () =>
    onChangeSettings({ shortcuts: [...shortcuts, { name: '', folder: '', command: '' }] });
  const removeShortcut = (i: number) =>
    onChangeSettings({ shortcuts: shortcuts.filter((_, j) => j !== i) });
  const browseFolder = async (i: number) => {
    const dir = await window.term.pickFolder();
    if (dir) setShortcut(i, { folder: dir });
  };
  // Dropping onto the folder field fills it in. resolveDropDir means dropping a
  // FILE from the folder works too — it resolves to the containing folder.
  const dropFolder = (i: number, e: React.DragEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation(); // App's window-level guard would otherwise swallow it
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const p = window.term.getPathForFile(file);
    if (!p) return;
    void window.term.resolveDropDir([p]).then((dir) => {
      if (dir) setShortcut(i, { folder: dir });
    });
  };

  return (
    <>
      {open && <div className="panel-scrim" onClick={onClose} />}
      <aside className={`settings-panel${open ? ' open' : ''}`} aria-hidden={!open}>
        <header className="panel-header">
          <h2>Settings</h2>
          <button className="panel-close" title="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="panel-body">
          {/* ---- Appearance · Theme ---- */}
          <section className="panel-section">
            <h3>Appearance · Theme</h3>
            <p className="hint theme-sub">
              Live preview — click to switch palette &amp; glow.
            </p>
            <div className="theme-grid">
              {PRESETS.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  className={`swatch${t.name === activeTheme.name ? ' active' : ''}`}
                  onClick={() => onChangeTheme(t.name)}
                >
                  <span
                    className="swatch-dot"
                    style={{ background: t.chrome.accent, color: t.chrome.accent }}
                  />
                  <span className="swatch-label">{t.name}</span>
                </button>
              ))}
            </div>

            {settings.customThemes.length > 0 && (
              <label className="field">
                <span>Custom themes</span>
                <select
                  value={isPresetActive ? '' : settings.activeTheme}
                  onChange={(e) => {
                    if (e.target.value) onChangeTheme(e.target.value);
                  }}
                >
                  <option value="">Select a custom theme…</option>
                  {settings.customThemes.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="field-row">
              <input
                type="text"
                placeholder="New theme name"
                value={newThemeName}
                onChange={(e) => setNewThemeName(e.target.value)}
              />
              <button
                className="btn"
                onClick={() => {
                  onSaveAsTheme(newThemeName);
                  setNewThemeName('');
                }}
              >
                Save as new
              </button>
            </div>
            {!isPresetActive && (
              <button
                className="btn btn-danger"
                onClick={() => onDeleteTheme(settings.activeTheme)}
              >
                Delete “{settings.activeTheme}”
              </button>
            )}
            <p className="hint">
              Editing a color or the glow below auto-forks a custom copy (it
              appears under Custom themes), so the palettes stay pristine.
            </p>
          </section>

          {/* ---- Font ---- */}
          <section className="panel-section">
            <h3>Font</h3>
            <label className="field">
              <span>Family</span>
              <input
                type="text"
                value={activeTheme.font.family}
                spellCheck={false}
                onChange={(e) => setFont({ family: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Size ({activeTheme.font.size}px)</span>
              <input
                type="range"
                min={8}
                max={28}
                value={activeTheme.font.size}
                onChange={(e) => setFont({ size: Number(e.target.value) })}
              />
            </label>
          </section>

          {/* ---- Terminal colors ---- */}
          <section className="panel-section">
            <h3>Terminal colors</h3>
            {XTERM_FIELDS.map((f) => (
              <ColorField
                key={f.key}
                label={f.label}
                value={activeTheme.xterm[f.key]}
                onChange={(v) => setXterm(f.key, v)}
              />
            ))}
          </section>

          {/* ---- Window chrome ---- */}
          <section className="panel-section">
            <h3>Window chrome</h3>
            <label className="field">
              <span>HUD glow ({Math.round((activeTheme.glowStrength ?? 1) * 100)}%)</span>
              <input
                type="range"
                min={0}
                max={200}
                value={Math.round((activeTheme.glowStrength ?? 1) * 100)}
                onChange={(e) =>
                  onEditTheme({
                    ...activeTheme,
                    glowStrength: Number(e.target.value) / 100,
                  })
                }
              />
            </label>
            {CHROME_FIELDS.map((f) => (
              <ColorField
                key={f.key}
                label={f.label}
                value={activeTheme.chrome[f.key]}
                onChange={(v) => setChrome(f.key, v)}
              />
            ))}
          </section>

          {/* ---- Window ---- */}
          <section className="panel-section">
            <h3>Window</h3>
            <label className="field">
              <span>Opacity ({Math.round(settings.windowOpacity * 100)}%)</span>
              <input
                type="range"
                min={30}
                max={100}
                value={Math.round(settings.windowOpacity * 100)}
                onChange={(e) =>
                  onChangeSettings({ windowOpacity: Number(e.target.value) / 100 })
                }
              />
            </label>
          </section>

          {/* ---- Completion ding ---- */}
          <section className="panel-section">
            <h3>Completion ding</h3>
            <label className="field field-check">
              <input
                type="checkbox"
                checked={settings.dingEnabled}
                onChange={(e) => onChangeSettings({ dingEnabled: e.target.checked })}
              />
              <span>Play a sound when a command or Claude Code response finishes</span>
            </label>
            <label className="field">
              <span>Only for shell commands longer than (ms)</span>
              <input
                type="number"
                min={0}
                step={500}
                value={settings.dingThresholdMs}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) {
                    onChangeSettings({ dingThresholdMs: Math.max(0, Math.round(n)) });
                  }
                }}
              />
            </label>
            <div className="field-row">
              <button className="btn" onClick={pickSound}>
                Choose sound…
              </button>
              {settings.dingSound !== 'builtin' && (
                <button
                  className="btn"
                  onClick={() => onChangeSettings({ dingSound: 'builtin' })}
                >
                  Use built-in
                </button>
              )}
              <button className="btn" onClick={onTestSound}>
                Test
              </button>
            </div>
            <p className="hint">
              Sound: {settings.dingSound === 'builtin' ? 'built-in chime' : 'custom file'}.
              Works automatically in PowerShell — no setup needed.
            </p>
          </section>

          {/* ---- Shortcuts ---- */}
          <section className="panel-section">
            <h3>Shortcuts</h3>
            <p className="hint">
              Type the name at the prompt to jump to a folder and run something —
              e.g. <code>rf</code> → the reporterflow repo + <code>claude</code>.
              Conduit defines these in every shell it starts, so there&apos;s no
              profile to edit. Extra arguments pass through (<code>rf --continue</code>).
            </p>
            {shortcuts.map((sc, i) => {
              const problem = shortcutProblem(sc, i, shortcuts);
              return (
                <div className="shortcut" key={i}>
                  <div className="shortcut-row">
                    <input
                      className="sc-name"
                      type="text"
                      placeholder="rf"
                      spellCheck={false}
                      value={sc.name}
                      onChange={(e) => setShortcut(i, { name: e.target.value })}
                    />
                    <input
                      className="sc-folder"
                      type="text"
                      placeholder="Folder — drag one here"
                      spellCheck={false}
                      value={sc.folder}
                      onChange={(e) => setShortcut(i, { folder: e.target.value })}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = 'copy';
                      }}
                      onDrop={(e) => dropFolder(i, e)}
                    />
                    <button
                      className="btn sc-btn"
                      title="Choose a folder…"
                      onClick={() => browseFolder(i)}
                    >
                      …
                    </button>
                    <button
                      className="btn btn-danger sc-btn"
                      title="Delete this shortcut"
                      onClick={() => removeShortcut(i)}
                    >
                      ✕
                    </button>
                  </div>
                  <input
                    className="sc-cmd"
                    type="text"
                    placeholder="Command to run there (optional) — e.g. claude"
                    spellCheck={false}
                    value={sc.command}
                    onChange={(e) => setShortcut(i, { command: e.target.value })}
                  />
                  {problem && <p className="sc-problem">{problem}</p>}
                </div>
              );
            })}
            <button className="btn" onClick={addShortcut}>
              ＋ Add shortcut
            </button>
            <p className="hint">
              Changes apply to every open tab as soon as you close this panel. A tab
              that&apos;s busy (mid-command, or running something like Claude Code)
              picks them up at its next prompt.
            </p>
          </section>

          {/* ---- Shell ---- */}
          <section className="panel-section">
            <h3>Shell</h3>
            <label className="field">
              <span>Shell override (blank = auto: pwsh → powershell)</span>
              <input
                type="text"
                placeholder="pwsh.exe"
                value={settings.shell ?? ''}
                spellCheck={false}
                onChange={(e) => onChangeSettings({ shell: e.target.value })}
              />
            </label>
            <p className="hint">Changing the shell takes effect on the next launch.</p>
          </section>
        </div>
      </aside>
    </>
  );
}
