/**
 * Assemble a runnable Pi agent from an `AgentDefinition`.
 *
 * Combines the definition's system prompt with the skills block, and builds the
 * full tool set: internal tools (bash/fs), the `load_skill` tool, and one tool
 * per enabled MCP server tool.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentDefinition, McpServer, Skill } from "@/types";
import { buildInternalTools } from "./tools/internal";
import type { RequestCheckpoint } from "./tools/internal";
import { buildMcpTools } from "./tools/mcp";
import { buildLoadSkillTool, formatSkillsPrompt } from "./tools/skills";

export interface ResolveAgentDeps {
  /** All known skills (filtered to the definition's enabled set). */
  skills: Skill[];
  /** All known MCP servers (filtered to the definition's enabled set). */
  mcpServers: McpServer[];
  /** Absolute execution root for internal tools. Empty = managed temp sandbox. */
  workspacePath?: string;
  /** Optional human approval bridge used by the checkpoint internal tool. */
  requestCheckpoint?: RequestCheckpoint;
}

export interface ResolvedAgent {
  systemPrompt: string;
  tools: AgentTool[];
  /** MCP servers that failed inspection, surfaced to the UI. */
  mcpErrors: { server: string; error: string }[];
  /** MCP servers still warming up in the background (skipped this turn). */
  mcpPending: string[];
}

function activeSkills(def: AgentDefinition, all: Skill[]): Skill[] {
  const enabled = new Set(def.enabledSkillIds);
  return all.filter((s) => s.enabled !== false && enabled.has(s.id));
}

function activeMcpServers(def: AgentDefinition, all: McpServer[]): McpServer[] {
  const enabled = new Set(def.enabledMcpServerIds);
  return all.filter((s) => s.enabled !== false && enabled.has(s.id));
}

export function resolveSystemPrompt(
  def: AgentDefinition,
  skills: Skill[]
): string {
  const blocks: string[] = [];
  if (def.systemPrompt.trim()) blocks.push(def.systemPrompt.trim());
  const skillsBlock = formatSkillsPrompt(activeSkills(def, skills));
  if (skillsBlock) blocks.push(skillsBlock);
  return blocks.join("\n\n");
}

/** Build the system prompt + tool set for a definition. */
export async function resolveAgent(
  def: AgentDefinition,
  deps: ResolveAgentDeps
): Promise<ResolvedAgent> {
  const skills = activeSkills(def, deps.skills);
  const servers = activeMcpServers(def, deps.mcpServers);

  const tools: AgentTool[] = [];

  // Internal tools use the run/session execution root, not the reusable agent
  // definition. The backend resolves an empty root to its managed temporary
  // sandbox directory.
  const root = deps.workspacePath?.trim() ?? "";
  const enabledInternal = def.enabledInternalTools;
  if (enabledInternal.length > 0) {
    tools.push(
      ...buildInternalTools(enabledInternal, {
        sandboxMode: def.sandboxMode,
        workspaceRoot: root,
        requestCheckpoint: deps.requestCheckpoint,
      })
    );
  }

  if (skills.length > 0) {
    tools.push(buildLoadSkillTool(skills));
  }

  const mcp = await buildMcpTools(servers);
  tools.push(...mcp.tools);

  return {
    systemPrompt: resolveSystemPrompt(def, deps.skills),
    tools,
    mcpErrors: mcp.errors,
    mcpPending: mcp.pending,
  };
}
