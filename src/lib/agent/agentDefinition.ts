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
import type { RequestCheckpoint, RequestAsk } from "./tools/internal";
import { buildMcpTools } from "./tools/mcp";
import { buildConnectorTools } from "./tools/connector";
import { buildLoadSkillTool, formatSkillsPrompt } from "./tools/skills";
import { makeToolAbortable } from "./tools/shared";

export interface ResolveAgentDeps {
  /** All known skills (filtered to the definition's enabled set). */
  skills: Skill[];
  /** All known MCP servers (filtered to the definition's enabled set). */
  mcpServers: McpServer[];
  /** Absolute execution root for internal tools. Empty = managed temp sandbox. */
  workspacePath?: string;
  /** Optional human approval bridge used by the checkpoint internal tool. */
  requestCheckpoint?: RequestCheckpoint;
  /** Optional human input bridge used by the ask_human internal tool. */
  requestAsk?: RequestAsk;
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
  return all.filter(
    (s) =>
      s.enabled !== false &&
      enabled.has(s.id) &&
      // Every server must be installed to activate. Legacy servers created
      // before the install lifecycle have `installed === undefined`, which we
      // treat as installed so they keep working.
      s.installed !== false
  );
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
        requestAsk: deps.requestAsk,
      })
    );
  }

  if (skills.length > 0) {
    tools.push(buildLoadSkillTool(skills));
  }

  const mcp = await buildMcpTools(servers, { screenshotDir: root || undefined });
  tools.push(...mcp.tools);

  // OpenConnector discovery/execute tools (opt-in per agent definition).
  if (def.connectorEnabled) {
    tools.push(...buildConnectorTools());
  }

  return {
    systemPrompt: resolveSystemPrompt(def, deps.skills),
    // Make every tool interruptible: pi's loop only re-checks the abort signal
    // after `execute` settles, so a tool that ignores the signal would otherwise
    // freeze the run and make the session impossible to stop mid-tool.
    tools: tools.map(makeToolAbortable),
    mcpErrors: mcp.errors,
    mcpPending: mcp.pending,
  };
}
