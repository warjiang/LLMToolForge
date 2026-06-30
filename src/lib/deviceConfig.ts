import { getStore } from "@/data/storage";

const DEVICE_ID_KEY = "deviceId";
const FEATURE_CONFIG_KEY = "featureConfig";

export type FeatureId =
  | "settings.appearance"
  | "settings.dataStorage"
  | "settings.storageSync"
  | "settings.updates"
  | "sidebar.dashboard"
  | "sidebar.providers"
  | "sidebar.unified"
  | "sidebar.skills"
  | "sidebar.mcp"
  | "sidebar.ssh"
  | "sidebar.tools"
  | "sidebar.browser";

export interface FeatureConfig {
  version: 1;
  features: Record<string, boolean>;
}

export const DEFAULT_FEATURES: Record<FeatureId, boolean> = {
  // Shows the appearance card with theme and language controls.
  "settings.appearance": true,
  // Shows the local data-storage status card.
  "settings.dataStorage": true,
  // Shows encrypted remote sync settings; disabled by default until sync is ready for broad use.
  "settings.storageSync": false,
  // Shows update status and manual update check controls in About.
  "settings.updates": true,
  // Shows the overview/dashboard navigation entry.
  "sidebar.dashboard": true,
  // Shows the model integration navigation entry.
  "sidebar.providers": true,
  // Shows the Unified API navigation entry.
  "sidebar.unified": true,
  // Shows the Skills navigation entry.
  "sidebar.skills": true,
  // Shows the MCP Servers navigation entry.
  "sidebar.mcp": true,
  // Shows the SSH navigation entry; disabled by default until SSH is ready for broad use.
  "sidebar.ssh": false,
  // Shows the utility tools navigation entry.
  "sidebar.tools": true,
  // Shows the embedded browser navigation entry; disabled by default.
  "sidebar.browser": false,
};

export const DEFAULT_FEATURE_CONFIG: FeatureConfig = {
  version: 1,
  features: { ...DEFAULT_FEATURES },
};

export type FeatureConfigValidation =
  | { ok: true; config: FeatureConfig }
  | { ok: false; error: string };

function cloneDefaultFeatureConfig(): FeatureConfig {
  return {
    version: DEFAULT_FEATURE_CONFIG.version,
    features: { ...DEFAULT_FEATURE_CONFIG.features },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nextDeviceId(): string {
  return crypto.randomUUID();
}

export async function loadDeviceId(): Promise<string> {
  const store = getStore();
  const stored = await store.get<string>(DEVICE_ID_KEY);
  if (typeof stored === "string" && stored.trim()) return stored;

  const deviceId = nextDeviceId();
  await store.set(DEVICE_ID_KEY, deviceId);
  return deviceId;
}

export function normalizeFeatureConfig(value: unknown): FeatureConfig {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.features)) {
    return cloneDefaultFeatureConfig();
  }

  const features: Record<string, boolean> = {
    ...DEFAULT_FEATURES,
  };
  for (const [key, enabled] of Object.entries(value.features)) {
    if (typeof enabled === "boolean") {
      features[key] = enabled;
    }
  }

  return { version: 1, features };
}

export function validateFeatureConfig(value: unknown): FeatureConfigValidation {
  if (!isRecord(value)) {
    return { ok: false, error: "Config must be a JSON object." };
  }
  if (value.version !== 1) {
    return { ok: false, error: "Config version must be 1." };
  }
  if (!isRecord(value.features)) {
    return { ok: false, error: "Config features must be an object." };
  }

  for (const [key, enabled] of Object.entries(value.features)) {
    if (typeof enabled !== "boolean") {
      return {
        ok: false,
        error: `Feature "${key}" must be true or false.`,
      };
    }
  }

  return { ok: true, config: normalizeFeatureConfig(value) };
}

export async function loadFeatureConfig(): Promise<FeatureConfig> {
  const stored = await getStore().get<unknown>(FEATURE_CONFIG_KEY);
  return normalizeFeatureConfig(stored);
}

export async function saveFeatureConfig(config: FeatureConfig): Promise<FeatureConfig> {
  const normalized = normalizeFeatureConfig(config);
  await getStore().set(FEATURE_CONFIG_KEY, normalized);
  return normalized;
}

export function isFeatureEnabled(config: FeatureConfig, feature: FeatureId): boolean {
  return config.features[feature] ?? true;
}
