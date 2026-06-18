import Store from 'electron-store';
import { DEFAULT_SETTINGS, type Settings } from '../shared/types';

interface StoreSchema {
  settings: Settings;
}

// electron-store writes <userData>/conduit-settings.json.
const store = new Store<StoreSchema>({
  name: 'conduit-settings',
  defaults: { settings: DEFAULT_SETTINGS },
});

export function loadSettings(): Settings {
  // Spread defaults first so settings saved by older versions still get any
  // newly-added fields with sane values.
  return { ...DEFAULT_SETTINGS, ...store.get('settings') };
}

export function saveSettings(settings: Settings): void {
  store.set('settings', settings);
}
