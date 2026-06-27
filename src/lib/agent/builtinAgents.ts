import type { AgentDefinition } from "@/types";

/** Picker value representing "no agent / direct chat". */
export const DIRECT_AGENT_VALUE = "__direct__";
/** Built-in DataAgent identifier (not a stored AgentDefinition). */
export const DATA_AGENT_ID = "__builtin_dataagent__";
/** Display name for the built-in DataAgent. */
export const DATA_AGENT_NAME = "DataAgent";

/**
 * Resolve a human-readable label for a session's committed agent id.
 * Returns `null` for direct chat / no agent so callers can skip the tag.
 */
export function resolveAgentLabel(
  agentId: string | null | undefined,
  agentDefs: AgentDefinition[]
): string | null {
  if (!agentId || agentId === DIRECT_AGENT_VALUE) return null;
  if (agentId === DATA_AGENT_ID) return DATA_AGENT_NAME;
  return agentDefs.find((a) => a.id === agentId)?.name ?? null;
}
