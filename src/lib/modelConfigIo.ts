/**
 * One-click export / import of the model connections that drive the Unified API
 * "Exposed Models" list.
 *
 * The exposed-model list itself is derived at runtime by `buildExposedModels`
 * from three persisted connection collections plus the disabled-model set, so
 * those are exactly what we move between machines:
 *   - apiKeys            (manual OpenAI-compatible keys)
 *   - gatewayConnections (new-api / litellm / dmxapi)
 *   - volcCredentials    (Volcengine Ark)
 *   - unifiedApiConfig.disabledModelIds (per-model enable switches)
 *
 * The file is plain UTF-8 JSON by design — it is meant for sharing across the
 * user's own dev terminals, not for untrusted distribution. Import is additive:
 * connections that already exist (same name + same key/secret + same base url)
 * are skipped so re-importing is idempotent.
 */

import { isTauri } from "@/lib/utils";
import { loadConfig, saveConfig } from "@/lib/unifiedApi";
import {
  useApiKeyStore,
  useGatewayStore,
  useVolcCredentialStore,
  reloadSyncedData,
} from "@/store";
import { useUnifiedStore } from "@/store/unified";
import type { ApiKey, GatewayConnection, VolcCredential } from "@/types";
import type { ModelInfo } from "@/lib/providers/types";

const FILE_TYPE = "llmtoolforge.model-config";
const FILE_VERSION = 1;
const DEFAULT_FILENAME = "llmtoolforge-models.json";

export interface ModelConfigFile {
  type: typeof FILE_TYPE;
  version: number;
  exportedAt: string;
  connections: {
    apiKeys: ApiKey[];
    gatewayConnections: GatewayConnection[];
    volcCredentials: VolcCredential[];
  };
  disabledModelIds: string[];
}

export interface ImportSummary {
  /** Brand-new manual-key connections added. */
  apiKeys: number;
  /** Brand-new gateway connections added. */
  gatewayConnections: number;
  /** Brand-new Volcengine credentials added. */
  volcCredentials: number;
  /** Models merged into connections that already existed locally. */
  mergedModels: number;
  /** Existing connections that contributed nothing new. */
  skipped: number;
}

class DesktopOnlyError extends Error {
  constructor() {
    super("Model config import/export is only available in the desktop app.");
    this.name = "DesktopOnlyError";
  }
}

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new DesktopOnlyError();
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

function stripMeta<T extends { id: string; createdAt: string; updatedAt: string }>(
  entity: T
): Omit<T, "id" | "createdAt" | "updatedAt"> {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = entity;
  void _id;
  void _c;
  void _u;
  return rest;
}

const norm = (value: string | undefined): string => (value ?? "").trim();

const apiKeySig = (k: Pick<ApiKey, "name" | "baseUrl" | "key">): string =>
  [norm(k.name), norm(k.baseUrl), norm(k.key)].join("|");

const gatewaySig = (
  g: Pick<GatewayConnection, "name" | "baseUrl" | "apiKey">
): string => [norm(g.name), norm(g.baseUrl), norm(g.apiKey)].join("|");

const volcSig = (
  v: Pick<VolcCredential, "name" | "accessKey" | "secretKey">
): string => [norm(v.name), norm(v.accessKey), norm(v.secretKey)].join("|");

/** Union of two string-id model lists (manual API keys), preserving order. */
function mergeStringModels(
  existing: string[] | undefined,
  incoming: string[] | undefined
): { models: string[]; added: number } {
  const result = [...(existing ?? [])];
  const seen = new Set(result);
  let added = 0;
  for (const id of incoming ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    added += 1;
  }
  return { models: result, added };
}

/** Union of two ModelInfo lists (gateway / volc), de-duped by model id. */
function mergeModelInfo(
  existing: ModelInfo[] | undefined,
  incoming: ModelInfo[] | undefined
): { models: ModelInfo[]; added: number } {
  const result = [...(existing ?? [])];
  const seen = new Set(result.map((m) => m.id));
  let added = 0;
  for (const m of incoming ?? []) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    result.push(m);
    added += 1;
  }
  return { models: result, added };
}

/** Assemble the current model configuration into a portable plaintext object. */
export async function collectModelConfig(): Promise<ModelConfigFile> {
  const config = await loadConfig();
  return {
    type: FILE_TYPE,
    version: FILE_VERSION,
    exportedAt: new Date().toISOString(),
    connections: {
      apiKeys: useApiKeyStore.getState().items,
      gatewayConnections: useGatewayStore.getState().items,
      volcCredentials: useVolcCredentialStore.getState().items,
    },
    disabledModelIds: config.disabledModelIds,
  };
}

/**
 * Export all model connections to a JSON file chosen via a save dialog.
 * Returns false if the user cancelled.
 */
export async function exportModelConfig(): Promise<boolean> {
  if (!isTauri()) throw new DesktopOnlyError();
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({
    defaultPath: DEFAULT_FILENAME,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path) return false;
  const payload = await collectModelConfig();
  await invoke<void>("model_config_export", {
    path,
    contents: JSON.stringify(payload, null, 2),
  });
  return true;
}

function parseModelConfig(json: string): ModelConfigFile {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("invalid_json");
  }
  if (
    !data ||
    typeof data !== "object" ||
    (data as { type?: unknown }).type !== FILE_TYPE
  ) {
    throw new Error("not_model_config");
  }
  const file = data as Partial<ModelConfigFile>;
  const conns = file.connections ?? {
    apiKeys: [],
    gatewayConnections: [],
    volcCredentials: [],
  };
  return {
    type: FILE_TYPE,
    version: file.version ?? FILE_VERSION,
    exportedAt: file.exportedAt ?? "",
    connections: {
      apiKeys: Array.isArray(conns.apiKeys) ? conns.apiKeys : [],
      gatewayConnections: Array.isArray(conns.gatewayConnections)
        ? conns.gatewayConnections
        : [],
      volcCredentials: Array.isArray(conns.volcCredentials)
        ? conns.volcCredentials
        : [],
    },
    disabledModelIds: Array.isArray(file.disabledModelIds)
      ? file.disabledModelIds
      : [],
  };
}

/**
 * Pick a JSON config file and merge-append its connections into the local
 * stores. A connection that doesn't exist locally is added as-is. A connection
 * that already exists (same name + base url + key/secret signature) is NOT
 * skipped wholesale — its model list is merged into the local connection so
 * newly-added models (e.g. a model appended to an existing provider) get
 * imported too. The disabled-model switches are unioned with the local ones.
 * Returns null if cancelled.
 */
export async function importModelConfig(): Promise<ImportSummary | null> {
  if (!isTauri()) throw new DesktopOnlyError();
  const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
  const selected = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  const path = Array.isArray(selected) ? selected[0] : selected;
  if (!path) return null;

  const json = await invoke<string>("model_config_import", { path });
  const file = parseModelConfig(json);

  const apiKeyStore = useApiKeyStore.getState();
  const gatewayStore = useGatewayStore.getState();
  const volcStore = useVolcCredentialStore.getState();

  const existingApiKeys = new Map(apiKeyStore.items.map((k) => [apiKeySig(k), k]));
  const existingGateways = new Map(
    gatewayStore.items.map((g) => [gatewaySig(g), g])
  );
  const existingVolc = new Map(volcStore.items.map((v) => [volcSig(v), v]));

  const summary: ImportSummary = {
    apiKeys: 0,
    gatewayConnections: 0,
    volcCredentials: 0,
    mergedModels: 0,
    skipped: 0,
  };

  for (const k of file.connections.apiKeys) {
    const existing = existingApiKeys.get(apiKeySig(k));
    if (existing) {
      const { models, added } = mergeStringModels(existing.models, k.models);
      if (added > 0) {
        await apiKeyStore.edit(existing.id, { models });
        summary.mergedModels += added;
      } else {
        summary.skipped += 1;
      }
      continue;
    }
    const created = stripMeta(k);
    existingApiKeys.set(apiKeySig(k), { ...k });
    await apiKeyStore.add(created);
    summary.apiKeys += 1;
  }

  for (const g of file.connections.gatewayConnections) {
    const existing = existingGateways.get(gatewaySig(g));
    if (existing) {
      const { models, added } = mergeModelInfo(existing.models, g.models);
      if (added > 0) {
        await gatewayStore.edit(existing.id, { models });
        summary.mergedModels += added;
      } else {
        summary.skipped += 1;
      }
      continue;
    }
    existingGateways.set(gatewaySig(g), { ...g });
    await gatewayStore.add(stripMeta(g));
    summary.gatewayConnections += 1;
  }

  for (const v of file.connections.volcCredentials) {
    const existing = existingVolc.get(volcSig(v));
    if (existing) {
      const { models, added } = mergeModelInfo(existing.models, v.models);
      if (added > 0) {
        await volcStore.edit(existing.id, { models });
        summary.mergedModels += added;
      } else {
        summary.skipped += 1;
      }
      continue;
    }
    existingVolc.set(volcSig(v), { ...v });
    await volcStore.add(stripMeta(v));
    summary.volcCredentials += 1;
  }

  if (file.disabledModelIds.length > 0) {
    const current = await loadConfig();
    const merged = [
      ...new Set([...current.disabledModelIds, ...file.disabledModelIds]),
    ];
    await saveConfig({ ...current, disabledModelIds: merged });
  }

  // Refresh provider stores and rebuild the exposed-model list so the new
  // connections show up immediately.
  await reloadSyncedData();
  await useUnifiedStore.getState().hydrateModels();

  return summary;
}
