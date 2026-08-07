import Store from 'electron-store';
import { DEFAULT_SETTINGS, type Settings } from '../shared/types';

interface StoreSchema {
  settings: Settings;
}

// electron-store writes <userData>/conduit-settings.json, resolving that path
// when the Store is CONSTRUCTED. So it must not be built at import time: main.ts
// redirects userData (CONDUIT_USER_DATA) in its module body, which runs after
// its imports — an eager store pinned itself to the real userData, and a dev
// instance then read and wrote the installed app's live settings.
let store: Store<StoreSchema> | null = null;

function getStore(): Store<StoreSchema> {
  if (!store) {
    store = new Store<StoreSchema>({
      name: 'conduit-settings',
      defaults: { settings: DEFAULT_SETTINGS },
    });
  }
  return store;
}

export function loadSettings(): Settings {
  // Spread defaults first so settings saved by older versions still get any
  // newly-added fields with sane values.
  return { ...DEFAULT_SETTINGS, ...getStore().get('settings') };
}

export function saveSettings(settings: Settings): void {
  getStore().set('settings', settings);
}
