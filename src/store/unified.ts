import { create } from "zustand";
import {
  buildExposedModels,
  clearLogs as clearLogsCmd,
  DEFAULT_CONFIG,
  getLogs,
  getStats,
  getStatus,
  isTauri,
  loadConfig,
  modelsToRoutes,
  onCallLog,
  pushConfig,
  saveConfig,
  startServer,
  stopServer,
  type CallLogRecord,
  type ExposedModel,
  type UnifiedApiConfig,
  type UnifiedStats,
  type UnifiedStatus,
} from "@/lib/unifiedApi";
import {
  useApiKeyStore,
  useGatewayStore,
  useVolcCredentialStore,
} from "@/store";

const LOG_CAP = 1000;
const BACKGROUND_HYDRATE_DELAY_MS = 700;

let providerUnsubscribes: Array<() => void> = [];
let modelHydrationPromise: Promise<void> | null = null;
let backgroundHydrationScheduled = false;
let callLogSubscriptionScheduled = false;

function runAfterFirstPaint(callback: () => void): void {
  if (typeof window === "undefined") {
    setTimeout(callback, 0);
    return;
  }

  window.setTimeout(() => {
    const win = window as Window & {
      requestIdleCallback?: (
        cb: () => void,
        options?: { timeout: number }
      ) => number;
    };

    if (win.requestIdleCallback) {
      win.requestIdleCallback(callback, { timeout: 2000 });
      return;
    }

    callback();
  }, BACKGROUND_HYDRATE_DELAY_MS);
}

async function loadConnectionStores(): Promise<void> {
  const stores = [
    useVolcCredentialStore,
    useGatewayStore,
    useApiKeyStore,
  ];

  await Promise.all(
    stores.map((store) => {
      const state = store.getState();
      if (state.loaded || state.loading) return Promise.resolve();
      return state.load();
    })
  );
}

interface UnifiedState {
  supported: boolean;
  initialized: boolean;
  modelsHydrated: boolean;
  hydratingModels: boolean;
  config: UnifiedApiConfig;
  status: UnifiedStatus | null;
  models: ExposedModel[];
  logs: CallLogRecord[];
  stats: UnifiedStats | null;
  busy: boolean;
  error: string | null;

  init: () => Promise<void>;
  hydrateModels: () => Promise<void>;
  rebuild: () => Promise<void>;
  setConfig: (patch: Partial<UnifiedApiConfig>) => Promise<void>;
  toggleModel: (id: string, enabled: boolean) => Promise<void>;
  removeModel: (model: ExposedModel) => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  refreshStats: () => Promise<void>;
  loadLogs: () => Promise<void>;
  clearLogs: () => Promise<void>;
}

function currentModels(): ExposedModel[] {
  return buildExposedModels(
    useVolcCredentialStore.getState().items,
    useGatewayStore.getState().items,
    useApiKeyStore.getState().items
  );
}

export const useUnifiedStore = create<UnifiedState>((set, get) => ({
  supported: isTauri(),
  initialized: false,
  modelsHydrated: false,
  hydratingModels: false,
  config: DEFAULT_CONFIG,
  status: null,
  models: [],
  logs: [],
  stats: null,
  busy: false,
  error: null,

  init: async () => {
    if (get().initialized) return;
    set({ initialized: true });

    let config = DEFAULT_CONFIG;
    try {
      config = await loadConfig();
      set({ config });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }

    const scheduleModelHydration = () => {
      if (backgroundHydrationScheduled) return;
      backgroundHydrationScheduled = true;
      runAfterFirstPaint(() => {
        backgroundHydrationScheduled = false;
        const shouldPushRoutes = get().supported && get().status?.running;
        void (shouldPushRoutes ? get().rebuild() : get().hydrateModels()).catch(
          () => undefined
        );
      });
    };

    if (!get().supported) {
      scheduleModelHydration();
      return;
    }

    try {
      const status = await getStatus();
      set({ status });
      if (config.autoStart && !status.running) {
        void get().start();
      } else {
        scheduleModelHydration();
      }

      if (!callLogSubscriptionScheduled) {
        callLogSubscriptionScheduled = true;
        runAfterFirstPaint(() => {
          void onCallLog((rec) => {
            set((s) => ({ logs: [rec, ...s.logs].slice(0, LOG_CAP) }));
          }).catch((e) => {
            set({ error: e instanceof Error ? e.message : String(e) });
          });
        });
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      scheduleModelHydration();
    }
  },

  hydrateModels: async () => {
    if (get().modelsHydrated) return;
    if (modelHydrationPromise) return modelHydrationPromise;

    set({ hydratingModels: true, error: null });

    modelHydrationPromise = (async () => {
      await loadConnectionStores();
      set({
        models: currentModels(),
        modelsHydrated: true,
        hydratingModels: false,
      });

      if (providerUnsubscribes.length === 0) {
        const onChange = () => {
          set({ models: currentModels() });
          if (get().supported && get().status?.running) {
            void get().rebuild().catch(() => undefined);
          }
        };
        providerUnsubscribes = [
          useVolcCredentialStore.subscribe(onChange),
          useGatewayStore.subscribe(onChange),
          useApiKeyStore.subscribe(onChange),
        ];
      }
    })()
      .catch((e) => {
        set({
          hydratingModels: false,
          error: e instanceof Error ? e.message : String(e),
        });
        throw e;
      })
      .finally(() => {
        modelHydrationPromise = null;
      });

    return modelHydrationPromise;
  },

  rebuild: async () => {
    if (!get().supported) return;
    await get().hydrateModels();
    const { config } = get();
    const models = currentModels();
    const routes = modelsToRoutes(models, new Set(config.disabledModelIds));
    const status = await pushConfig(config, routes);
    set({ models, status });
  },

  setConfig: async (patch) => {
    const config = { ...get().config, ...patch };
    set({ config });
    await saveConfig(config);
    if (get().supported && get().status?.running) {
      await get().rebuild();
    } else {
      const status = get().status;
      if (status) {
        set({
          status: {
            ...status,
            port: config.port,
            hasLocalKey: Boolean(config.localKey),
          },
        });
      }
    }
  },

  toggleModel: async (id, enabled) => {
    const set0 = new Set(get().config.disabledModelIds);
    if (enabled) set0.delete(id);
    else set0.add(id);
    await get().setConfig({ disabledModelIds: [...set0] });
  },

  removeModel: async (model) => {
    // Exposed models are derived from each connection's `models` array, so
    // "deleting a model" means stripping its upstream id from the owning
    // connection and persisting. The provider-store subscription installed in
    // hydrateModels then rebuilds the exposed list (and re-pushes routes when
    // the server is running). We also drop any stale disabled-switch entry.
    const sep = model.connId.indexOf(":");
    const kind = model.connId.slice(0, sep);
    const ownerId = model.connId.slice(sep + 1);

    if (kind === "volc") {
      const store = useVolcCredentialStore.getState();
      const cred = store.items.find((c) => c.id === ownerId);
      if (cred) {
        await store.edit(ownerId, {
          models: (cred.models ?? []).filter((m) => m.id !== model.realModel),
        });
      }
    } else if (kind === "gw") {
      const store = useGatewayStore.getState();
      const conn = store.items.find((c) => c.id === ownerId);
      if (conn) {
        await store.edit(ownerId, {
          models: (conn.models ?? []).filter((m) => m.id !== model.realModel),
        });
      }
    } else if (kind === "key") {
      const store = useApiKeyStore.getState();
      const conn = store.items.find((c) => c.id === ownerId);
      if (conn) {
        await store.edit(ownerId, {
          models: (conn.models ?? []).filter((id) => id !== model.realModel),
        });
      }
    }

    if (get().config.disabledModelIds.includes(model.id)) {
      await get().setConfig({
        disabledModelIds: get().config.disabledModelIds.filter(
          (id) => id !== model.id
        ),
      });
    }
  },

  start: async () => {
    if (!get().supported) return;
    set({ busy: true, error: null });
    try {
      await get().rebuild();
      const status = await startServer();
      set({ status });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ busy: false });
    }
  },

  stop: async () => {
    if (!get().supported) return;
    set({ busy: true, error: null });
    try {
      const status = await stopServer();
      set({ status });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ busy: false });
    }
  },

  refreshStats: async () => {
    if (!get().supported) return;
    try {
      const stats = await getStats();
      set({ stats });
    } catch {
      /* ignore */
    }
  },

  loadLogs: async () => {
    if (!get().supported) return;
    try {
      const logs = await getLogs(LOG_CAP);
      set({ logs });
    } catch {
      /* ignore */
    }
  },

  clearLogs: async () => {
    if (get().supported) await clearLogsCmd();
    set({ logs: [], stats: null });
  },
}));
