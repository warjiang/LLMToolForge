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

interface UnifiedState {
  supported: boolean;
  initialized: boolean;
  config: UnifiedApiConfig;
  status: UnifiedStatus | null;
  models: ExposedModel[];
  logs: CallLogRecord[];
  stats: UnifiedStats | null;
  busy: boolean;
  error: string | null;

  init: () => Promise<void>;
  rebuild: () => Promise<void>;
  setConfig: (patch: Partial<UnifiedApiConfig>) => Promise<void>;
  toggleModel: (id: string, enabled: boolean) => Promise<void>;
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

    const config = await loadConfig();
    set({ config });

    // Ensure the underlying connection stores are loaded.
    await Promise.all([
      useVolcCredentialStore.getState().load(),
      useGatewayStore.getState().load(),
      useApiKeyStore.getState().load(),
    ]);
    set({ models: currentModels() });

    // Re-push the routing table whenever any connection store changes.
    const onChange = () => {
      set({ models: currentModels() });
      void get().rebuild();
    };
    useVolcCredentialStore.subscribe(onChange);
    useGatewayStore.subscribe(onChange);
    useApiKeyStore.subscribe(onChange);

    if (!get().supported) return;

    try {
      await get().rebuild();
      const status = await getStatus();
      set({ status });
      if (config.autoStart && !status.running) {
        await get().start();
      }
      await onCallLog((rec) => {
        set((s) => ({ logs: [rec, ...s.logs].slice(0, LOG_CAP) }));
      });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  rebuild: async () => {
    if (!get().supported) return;
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
    await get().rebuild();
  },

  toggleModel: async (id, enabled) => {
    const set0 = new Set(get().config.disabledModelIds);
    if (enabled) set0.delete(id);
    else set0.add(id);
    await get().setConfig({ disabledModelIds: [...set0] });
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
