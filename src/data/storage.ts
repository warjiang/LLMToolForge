/**
 * Storage abstraction. Uses the Tauri Store plugin when running inside Tauri,
 * and falls back to localStorage for browser-based development.
 *
 * This indirection keeps the rest of the app decoupled from the persistence
 * backend, so it can later be swapped for a real backend / SQLite without
 * touching the repository or UI layers.
 */

export interface KeyValueStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
}

const STORE_FILE = "llmtoolforge.json";

function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    // Tauri v2 exposes this internal global in the webview
    (("__TAURI_INTERNALS__" in window) || "__TAURI__" in window)
  );
}

class LocalStorageStore implements KeyValueStore {
  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = localStorage.getItem(`${STORE_FILE}:${key}`);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    localStorage.setItem(`${STORE_FILE}:${key}`, JSON.stringify(value));
  }
}

class TauriStore implements KeyValueStore {
  private storePromise: Promise<{
    get: <T>(k: string) => Promise<T | undefined>;
    set: (k: string, v: unknown) => Promise<void>;
    save: () => Promise<void>;
  }> | null = null;

  private async store() {
    if (!this.storePromise) {
      this.storePromise = import("@tauri-apps/plugin-store").then(({ load }) =>
        load(STORE_FILE, { autoSave: true, defaults: {} })
      );
    }
    return this.storePromise;
  }

  async get<T>(key: string): Promise<T | null> {
    const s = await this.store();
    const value = await s.get<T>(key);
    return value ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    const s = await this.store();
    await s.set(key, value);
    await s.save();
  }
}

let instance: KeyValueStore | null = null;

export function getStore(): KeyValueStore {
  if (!instance) {
    instance = isTauri() ? new TauriStore() : new LocalStorageStore();
  }
  return instance;
}
