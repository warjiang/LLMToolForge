export type WebToolSource =
  | { kind: "builtin" }
  | { kind: "mcp"; serverId: string }
  | { kind: "off" };

export const LEGACY_BUILTIN_WEB_MCP_IDS = new Set([
  "builtin-web-search",
  "builtin-web-fetch",
]);

const OFF_WEB_TOOL_SOURCE: WebToolSource = { kind: "off" };

interface WebToolSourceLegacyConfig {
  webToolSource?: unknown;
  enabledInternalTools?: unknown;
  enabledMcpServerIds?: unknown;
}

export interface WebToolSourceCandidate {
  id: string;
  enabled?: boolean;
  installed?: boolean;
  webToolSourceCandidate?: boolean;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasLegacyBuiltinWebMcpId(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.some(
      (id) =>
        typeof id === "string" && LEGACY_BUILTIN_WEB_MCP_IDS.has(id.trim())
    )
  );
}

export function normalizeWebToolSource(value: unknown): WebToolSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return OFF_WEB_TOOL_SOURCE;
  }
  const source = value as Record<string, unknown>;
  if (source.kind === "builtin") return { kind: "builtin" };
  if (source.kind === "off") return OFF_WEB_TOOL_SOURCE;
  if (
    source.kind === "mcp" &&
    typeof source.serverId === "string" &&
    source.serverId.trim()
  ) {
    return { kind: "mcp", serverId: source.serverId.trim() };
  }
  return OFF_WEB_TOOL_SOURCE;
}

export function normalizeEnabledMcpServerIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  for (const valueId of value) {
    if (typeof valueId !== "string") continue;
    const id = valueId.trim();
    if (!id || LEGACY_BUILTIN_WEB_MCP_IDS.has(id)) continue;
    ids.add(id);
  }
  return [...ids];
}

/**
 * Decode a persisted source and migrate the pre-source Web signals once.
 * A supplied fallback is used only for an absent source, so malformed data
 * never silently enables Web access.
 */
export function normalizeWebToolSourceConfig(
  value: WebToolSourceLegacyConfig,
  fallback: WebToolSource = OFF_WEB_TOOL_SOURCE,
  candidates: readonly WebToolSourceCandidate[] = []
): WebToolSource {
  const hasSource = hasOwn(value, "webToolSource");
  if (hasSource) {
    return normalizeWebToolSource(value.webToolSource);
  }
  if (
    Array.isArray(value.enabledInternalTools) &&
    value.enabledInternalTools.includes("web_fetch")
  ) {
    return { kind: "builtin" };
  }
  const enabledIds = new Set(normalizeEnabledMcpServerIds(value.enabledMcpServerIds));
  const eligibleCandidates = new Map<string, WebToolSourceCandidate>();
  for (const candidate of candidates) {
    if (
      candidate.webToolSourceCandidate === true &&
      candidate.enabled !== false &&
      candidate.installed !== false &&
      enabledIds.has(candidate.id)
    ) {
      eligibleCandidates.set(candidate.id, candidate);
    }
  }
  if (eligibleCandidates.size === 1) {
    return { kind: "mcp", serverId: [...eligibleCandidates.keys()][0] };
  }
  if (hasLegacyBuiltinWebMcpId(value.enabledMcpServerIds)) {
    return { kind: "builtin" };
  }
  return fallback;
}

export function normalizeAgentWebToolSource(
  value: WebToolSourceLegacyConfig,
  candidates: readonly WebToolSourceCandidate[] = []
): WebToolSource {
  return normalizeWebToolSourceConfig(value, OFF_WEB_TOOL_SOURCE, candidates);
}

/** General (direct) and Research sessions start with built-in Web enabled. */
export function defaultWebToolSourceForSessionAgent(
  agentId: string | null | undefined
): WebToolSource {
  return agentId == null || agentId === "__research__"
    ? { kind: "builtin" }
    : OFF_WEB_TOOL_SOURCE;
}
