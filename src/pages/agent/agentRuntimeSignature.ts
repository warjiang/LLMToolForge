import type { AgentDefinition } from "@/types";

/** Stable signature so a cached runtime is reused until its config changes. */
export function agentRuntimeSignature(
  def: AgentDefinition,
  workspacePath: string
): string {
  return [
    def.id,
    def.modelId,
    def.systemPrompt,
    def.enabledInternalTools.join(","),
    def.enabledSkillIds.join(","),
    def.enabledMcpServerIds.join(","),
    def.connectorEnabled ? "conn" : "",
    def.sandboxMode,
    workspacePath,
    def.temperature,
    def.maxTokens,
  ].join("|");
}
