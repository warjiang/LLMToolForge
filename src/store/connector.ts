import { create } from "zustand";
import { getStore } from "@/data/storage";
import {
  getRuntimeStatus,
  isTauri,
  startRuntime,
  stopRuntime,
  type ConnectorStatus,
} from "@/lib/connector/api";

const CONFIG_KEY = "connectorConfig";

export interface ConnectorConfig {
  port: number;
  /** Start the runtime automatically when the app launches. */
  autoStart: boolean;
}

export const DEFAULT_CONNECTOR_CONFIG: ConnectorConfig = {
  port: 4160,
  autoStart: false,
};

async function loadConfig(): Promise<ConnectorConfig> {
  const stored = await getStore().get<Partial<ConnectorConfig>>(CONFIG_KEY);
  return { ...DEFAULT_CONNECTOR_CONFIG, ...(stored ?? {}) };
}

async function saveConfig(config: ConnectorConfig): Promise<void> {
  await getStore().set(CONFIG_KEY, config);
}

interface ConnectorState {
  supported: boolean;
  initialized: boolean;
  config: ConnectorConfig;
  status: ConnectorStatus | null;
  busy: boolean;
  error: string | null;

  init: () => Promise<void>;
  setConfig: (patch: Partial<ConnectorConfig>) => Promise<void>;
  refreshStatus: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export const useConnectorStore = create<ConnectorState>((set, get) => ({
  supported: isTauri(),
  initialized: false,
  config: DEFAULT_CONNECTOR_CONFIG,
  status: null,
  busy: false,
  error: null,

  init: async () => {
    if (get().initialized) return;
    set({ initialized: true });

    let config = DEFAULT_CONNECTOR_CONFIG;
    try {
      config = await loadConfig();
      set({ config });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }

    if (!get().supported) return;

    try {
      const status = await getRuntimeStatus();
      set({ status });
      if (config.autoStart && !status.running) {
        void get().start();
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  setConfig: async (patch) => {
    const config = { ...get().config, ...patch };
    set({ config });
    await saveConfig(config);
    // Reflect a not-yet-applied port change in the displayed status when the
    // runtime is stopped.
    const status = get().status;
    if (status && !status.running) {
      set({ status: { ...status, port: config.port } });
    }
  },

  refreshStatus: async () => {
    if (!get().supported) return;
    try {
      const status = await getRuntimeStatus();
      set({ status });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  start: async () => {
    if (!get().supported) return;
    set({ busy: true, error: null });
    try {
      const status = await startRuntime(get().config.port);
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
      const status = await stopRuntime();
      set({ status });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ busy: false });
    }
  },
}));
