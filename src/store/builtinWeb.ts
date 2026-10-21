import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  BUILTIN_WEB_STORAGE_KEY,
  createDefaultBuiltinWebConfig,
  normalizeBuiltinWebConfig,
  type BuiltinWebConfig,
} from "@/lib/agent/tools/webProviderCatalog";

interface BuiltinWebStore {
  config: BuiltinWebConfig;
  saveConfig: (config: BuiltinWebConfig) => void;
  resetConfig: () => void;
}

export const useBuiltinWebStore = create<BuiltinWebStore>()(
  persist(
    (set) => ({
      config: createDefaultBuiltinWebConfig(),
      saveConfig: (config) => set({ config: normalizeBuiltinWebConfig(config) }),
      resetConfig: () => set({ config: createDefaultBuiltinWebConfig() }),
    }),
    {
      name: BUILTIN_WEB_STORAGE_KEY,
      partialize: (state) => ({ config: state.config }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as { config?: unknown } | undefined;
        return {
          ...currentState,
          config: normalizeBuiltinWebConfig(persisted?.config),
        };
      },
    }
  )
);
