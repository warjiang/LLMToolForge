import { create } from "zustand";
import {
  DEFAULT_FEATURE_CONFIG,
  isFeatureEnabled,
  loadDeviceId,
  loadFeatureConfig,
  saveFeatureConfig,
  type FeatureConfig,
  type FeatureId,
} from "@/lib/deviceConfig";

interface DeviceConfigState {
  deviceId: string;
  featureConfig: FeatureConfig;
  loading: boolean;
  initialized: boolean;
  error: string | null;
  init: () => Promise<void>;
  saveFeatureConfig: (config: FeatureConfig) => Promise<void>;
  isFeatureEnabled: (feature: FeatureId) => boolean;
}

export const useDeviceConfigStore = create<DeviceConfigState>((set, get) => ({
  deviceId: "",
  featureConfig: DEFAULT_FEATURE_CONFIG,
  loading: false,
  initialized: false,
  error: null,

  init: async () => {
    if (get().loading || get().initialized) return;
    set({ loading: true, error: null });
    try {
      const [deviceId, featureConfig] = await Promise.all([
        loadDeviceId(),
        loadFeatureConfig(),
      ]);
      set({
        deviceId,
        featureConfig,
        loading: false,
        initialized: true,
      });
    } catch (e) {
      set({
        loading: false,
        initialized: true,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  saveFeatureConfig: async (config) => {
    const featureConfig = await saveFeatureConfig(config);
    set({ featureConfig });
  },

  isFeatureEnabled: (feature) =>
    isFeatureEnabled(get().featureConfig, feature),
}));
