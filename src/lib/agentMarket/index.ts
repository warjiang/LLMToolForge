/**
 * Update detection for GitHub-installed external agents.
 *
 * Mirrors `skillMarket`'s `checkSkillUpdate`: re-resolve the agent package from
 * its recorded GitHub source and compare the freshly computed content hash
 * against the hash stored at install time.
 */

import type { AgentDefinition } from "@/types";
import { resolveGithubAgent, type ResolvedGithubAgent } from "./github";

export type AgentUpdateState = "up-to-date" | "update-available" | "error";

export interface AgentUpdateCheck {
  def: AgentDefinition;
  state: AgentUpdateState;
  resolved?: ResolvedGithubAgent;
  error?: string;
}

/** Build the `owner/repo[/subdir][@ref]` reference for a GitHub-installed agent. */
export function agentSourceRef(def: AgentDefinition): string | null {
  const ext = def.external;
  if (!ext?.source) return null;
  let ref = ext.source;
  if (ext.sourceSubdir) ref += `/${ext.sourceSubdir}`;
  if (ext.sourceRef) ref += `@${ext.sourceRef}`;
  return ref;
}

/** Re-resolve a GitHub-installed agent and compare against its stored hash. */
export async function checkAgentUpdate(
  def: AgentDefinition,
  token?: string
): Promise<AgentUpdateCheck> {
  const ref = agentSourceRef(def);
  if (!ref) {
    return { def, state: "error", error: "Not a GitHub-installed agent" };
  }
  try {
    const resolved = await resolveGithubAgent(ref, token);
    const changed =
      !def.external?.installedHash ||
      def.external.installedHash !== resolved.hash;
    return {
      def,
      state: changed ? "update-available" : "up-to-date",
      resolved,
    };
  } catch (e) {
    return {
      def,
      state: "error",
      error: e instanceof Error ? e.message : "Update check failed",
    };
  }
}
