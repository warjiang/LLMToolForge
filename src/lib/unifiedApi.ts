/**
 * Frontend bridge for the local Unified API server.
 *
 * Credentials live in the frontend store; this module flattens the connected
 * providers into a routing table (`exposedModel -> upstream`) and pushes it to
 * the Rust server, which exposes OpenAI- and Anthropic-compatible endpoints.
 */

import type { ApiKey, GatewayConnection, VolcCredential } from "@/types";
import type { ModelInfo } from "@/lib/providers/types";
import { getStore } from "@/data/storage";

/** Volcengine Ark OpenAI-compatible base URL (region does not change it). */
const VOLC_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

const CONFIG_KEY = "unifiedApiConfig";

export const CALL_LOG_EVENT = "unified://call-log";

export interface UnifiedApiConfig {
  port: number;
  /** Optional local bearer key clients must present. Empty = no auth. */
  localKey: string;
  autoStart: boolean;
  /** Exposed model ids the user has turned off. */
  disabledModelIds: string[];
}

export const DEFAULT_CONFIG: UnifiedApiConfig = {
  port: 4141,
  localKey: "",
  autoStart: false,
  disabledModelIds: [],
};

/** One exposable model resolved from a connection. */
export interface ExposedModel {
  /** Public id exposed by the server, `{connName}/{model}`. */
  id: string;
  /** Upstream model id. */
  realModel: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  connId: string;
  connName: string;
  /** Capability tags for filtering/display (see MODEL_FEATURES). */
  features: ModelFeature[];
}

export type ModelFeature =
  | "vision"
  | "image-gen"
  | "video-gen"
  | "function-call";

export const MODEL_FEATURES: { value: ModelFeature; label: string }[] = [
  { value: "vision", label: "多模态" },
  { value: "image-gen", label: "生图" },
  { value: "video-gen", label: "生视频" },
  { value: "function-call", label: "函数调用" },
];

const FEATURE_LABEL: Record<ModelFeature, string> = MODEL_FEATURES.reduce(
  (acc, f) => {
    acc[f.value] = f.label;
    return acc;
  },
  {} as Record<ModelFeature, string>
);

export function featureLabel(f: ModelFeature): string {
  return FEATURE_LABEL[f] ?? f;
}

function modelFeatures(m: ModelInfo): ModelFeature[] {
  const out: ModelFeature[] = [];
  const mm =
    m.supportsVision ||
    (m.inputModalities ?? []).some((x) => x !== "text");
  if (mm) out.push("vision");
  if (m.supportsImageGeneration) out.push("image-gen");
  if (m.supportsVideoGeneration) out.push("video-gen");
  if (m.supportsFunctionCall) out.push("function-call");
  return out;
}

/** Shape sent to the Rust `unified_api_set_config` command (camelCase). */
export interface RouteInput {
  exposedModel: string;
  baseUrl: string;
  apiKey: string;
  realModel: string;
  provider: string;
}

export interface UnifiedStatus {
  running: boolean;
  port: number;
  routeCount: number;
  hasLocalKey: boolean;
  models: string[];
}

export interface CallLogRecord {
  id: number;
  ts: number;
  exposedModel: string;
  realModel: string;
  provider: string;
  protocol: string;
  stream: boolean;
  status: number;
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  error?: string;
  userAgent?: string;
}

export interface ModelStat {
  model: string;
  count: number;
  errors: number;
  totalTokens: number;
  avgDurationMs: number;
}

export interface UnifiedStats {
  total: number;
  success: number;
  errors: number;
  avgDurationMs: number;
  p95DurationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  byModel: ModelStat[];
}

export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

function sanitize(name: string): string {
  return name.trim().replace(/\s+/g, "-").replace(/\//g, "-") || "conn";
}

interface Candidate {
  realModel: string;
  slug: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  connId: string;
  connName: string;
  features: ModelFeature[];
}

/** Derive a readable model slug for a Volcengine endpoint (`ep-...`). */
function volcModelSlug(m: ModelInfo): string {
  const raw = m.raw as
    | { ModelReference?: { FoundationModel?: { Name?: string } } }
    | undefined;
  const fmName = raw?.ModelReference?.FoundationModel?.Name;
  const candidate = fmName || m.name || m.id;
  // Skip endpoint-id-looking values; fall back to a sanitized display name.
  if (/^ep-/i.test(candidate)) {
    const fromName = m.name && !/^ep-/i.test(m.name) ? m.name : "";
    return slugifyModel(fromName || m.id);
  }
  return slugifyModel(candidate);
}

/** Short, stable token derived from a connection id, for namespace tiebreaks. */
function connToken(connId: string): string {
  const tail = connId.includes(":")
    ? connId.slice(connId.indexOf(":") + 1)
    : connId;
  const slug = slugifyModel(tail);
  return slug.slice(-6) || "conn";
}

/** Normalize an arbitrary model label into a clean, url-safe slug. */
function slugifyModel(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[\s/]+/g, "-")
      .replace(/[^a-z0-9._-]/g, "")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "") || "model"
  );
}

/**
 * Flatten all connections into exposable models, assigning `{connName}/{model}`
 * ids. The connection name is the namespace so that distinct connections of the
 * same provider type (e.g. two `new-api` gateways) never collide; connections
 * that happen to share a name are disambiguated with a short connection token.
 */
export function buildExposedModels(
  volc: VolcCredential[],
  gateways: GatewayConnection[],
  manual: ApiKey[]
): ExposedModel[] {
  const candidates: Candidate[] = [];

  for (const cred of volc) {
    const key = (cred.apiKeys ?? []).find((k) => k.key)?.key;
    if (!key) continue;
    for (const m of cred.models ?? []) {
      candidates.push({
        realModel: m.id,
        slug: volcModelSlug(m),
        provider: "volcengine",
        baseUrl: VOLC_BASE_URL,
        apiKey: key,
        connId: `volc:${cred.id}`,
        connName: cred.name,
        features: modelFeatures(m),
      });
    }
  }

  for (const conn of gateways) {
    if (!conn.baseUrl || !conn.apiKey) continue;
    for (const m of conn.models ?? []) {
      candidates.push({
        realModel: m.id,
        slug: slugifyModel(m.id),
        provider: conn.provider,
        baseUrl: conn.baseUrl,
        apiKey: conn.apiKey,
        connId: `gw:${conn.id}`,
        connName: conn.name,
        features: modelFeatures(m),
      });
    }
  }

  for (const conn of manual) {
    if (!conn.baseUrl || !conn.key) continue;
    for (const id of conn.models ?? []) {
      candidates.push({
        realModel: id,
        slug: slugifyModel(id),
        provider: "manual",
        baseUrl: conn.baseUrl,
        apiKey: conn.key,
        connId: `key:${conn.id}`,
        connName: conn.name,
        features: [],
      });
    }
  }

  // Namespace ids by connection name. Detect names shared by >1 connection so
  // we only append a connection token where it is actually needed.
  const nsConns = new Map<string, Set<string>>();
  for (const c of candidates) {
    const ns = sanitize(c.connName);
    let set = nsConns.get(ns);
    if (!set) {
      set = new Set();
      nsConns.set(ns, set);
    }
    set.add(c.connId);
  }

  const seen = new Set<string>();
  const models: ExposedModel[] = [];
  for (const c of candidates) {
    const ns0 = sanitize(c.connName);
    const ns =
      (nsConns.get(ns0)?.size ?? 0) > 1
        ? `${ns0}-${connToken(c.connId)}`
        : ns0;
    const id = `${ns}/${c.slug}`;
    // Guard against any residual duplicate (same model twice in one conn).
    let unique = id;
    let n = 2;
    while (seen.has(unique)) {
      unique = `${id}-${n++}`;
    }
    seen.add(unique);
    models.push({
      id: unique,
      realModel: c.realModel,
      provider: c.provider,
      baseUrl: c.baseUrl,
      apiKey: c.apiKey,
      connId: c.connId,
      connName: c.connName,
      features: c.features,
    });
  }

  models.sort((a, b) => a.id.localeCompare(b.id));
  return models;
}

export function modelsToRoutes(
  models: ExposedModel[],
  disabled: Set<string>
): RouteInput[] {
  return models
    .filter((m) => !disabled.has(m.id))
    .map((m) => ({
      exposedModel: m.id,
      baseUrl: m.baseUrl,
      apiKey: m.apiKey,
      realModel: m.realModel,
      provider: m.provider,
    }));
}

// ---- persistence ----

export async function loadConfig(): Promise<UnifiedApiConfig> {
  const stored = await getStore().get<Partial<UnifiedApiConfig>>(CONFIG_KEY);
  return { ...DEFAULT_CONFIG, ...(stored ?? {}) };
}

export async function saveConfig(config: UnifiedApiConfig): Promise<void> {
  await getStore().set(CONFIG_KEY, config);
}

// ---- Tauri command wrappers ----

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function pushConfig(
  config: UnifiedApiConfig,
  routes: RouteInput[]
): Promise<UnifiedStatus> {
  return invoke<UnifiedStatus>("unified_api_set_config", {
    config: { port: config.port, localKey: config.localKey || null },
    routes,
  });
}

export async function startServer(): Promise<UnifiedStatus> {
  return invoke<UnifiedStatus>("unified_api_start");
}

export async function stopServer(): Promise<UnifiedStatus> {
  return invoke<UnifiedStatus>("unified_api_stop");
}

export async function getStatus(): Promise<UnifiedStatus> {
  return invoke<UnifiedStatus>("unified_api_status");
}

export async function getLogs(limit = 500): Promise<CallLogRecord[]> {
  return invoke<CallLogRecord[]>("unified_api_logs", { limit });
}

export async function clearLogs(): Promise<void> {
  return invoke<void>("unified_api_clear_logs");
}

export async function getStats(): Promise<UnifiedStats> {
  return invoke<UnifiedStats>("unified_api_stats");
}

export async function onCallLog(
  cb: (rec: CallLogRecord) => void
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<CallLogRecord>(CALL_LOG_EVENT, (e) =>
    cb(e.payload)
  );
  return unlisten;
}

/** Generate a random local API key. */
export function generateLocalKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return (
    "sk-local-" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}
