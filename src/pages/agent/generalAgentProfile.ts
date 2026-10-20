import {
  AGENT_INTERNAL_TOOL_IDS,
  type AgentDefinition,
  type AgentInternalToolId,
} from "@/types";
import type { ChatSessionSettings } from "@/types/chat";

export const ADHOC_AGENT_ID = "__adhoc__";
export const CHAT_REPORT_MIN_MAX_TOKENS = 8192;

const CHAT_REPORT_EXCLUDED_TOOLS = new Set<AgentInternalToolId>([
  "data_report_html",
  "html_artifact_create",
  "html_artifact_block",
]);

const CHAT_DELIVERY_INSTRUCTION = [
  "Report delivery: chat.",
  "When the user asks for a report, summary, or analysis, write it directly in your reply as well-structured Markdown (headings, lists, tables). Do not create a local report artifact.",
  'If the user asks for an HTML or previewable report, give the Markdown version and add one sentence saying they can switch "Report delivery" (报告交付方式) to "HTML report" (HTML 报告) in the configuration panel. Do not hand-write an HTML report with write or bash instead. This does not restrict coding tasks where the user asks for HTML source files.',
  "Keep reports focused. If a report would be very long, deliver the most important sections first and offer to continue.",
  "Use data_chart_html only when the user explicitly asks for a chart of local data.",
  "Save a Markdown file with write only when the user explicitly asks for a file.",
].join("\n");

const HTML_DELIVERY_INSTRUCTION = [
  "Report delivery: HTML report.",
  "When the user asks for a report or a polished deliverable page, build a previewable HTML artifact: scaffold it once with html_artifact_create, then add one section at a time with html_artifact_block. Use data_report_html only as a quick fallback.",
  "Answer ordinary questions that are not reports directly in chat.",
].join("\n");

export interface GeneralAgentProfile {
  systemPrompt: string;
  enabledInternalTools: AgentInternalToolId[];
  maxTokens: number;
}

export function resolveGeneralAgentProfile(
  settings: Pick<
    ChatSessionSettings,
    "system" | "maxTokens" | "reportDelivery"
  >
): GeneralAgentProfile {
  const isHtml = settings.reportDelivery === "html";
  const configuredMaxTokens = Number(settings.maxTokens) || 4096;
  const deliveryInstruction = isHtml
    ? HTML_DELIVERY_INSTRUCTION
    : CHAT_DELIVERY_INSTRUCTION;

  return {
    systemPrompt: [settings.system?.trim(), deliveryInstruction]
      .filter(Boolean)
      .join("\n\n"),
    enabledInternalTools: isHtml
      ? [...AGENT_INTERNAL_TOOL_IDS]
      : AGENT_INTERNAL_TOOL_IDS.filter(
          (tool) => !CHAT_REPORT_EXCLUDED_TOOLS.has(tool)
        ),
    maxTokens: isHtml
      ? configuredMaxTokens
      : Math.max(configuredMaxTokens, CHAT_REPORT_MIN_MAX_TOKENS),
  };
}

/**
 * Build an in-memory AgentDefinition from General Agent session settings.
 * With no workspace selected, internal tools use the managed session sandbox.
 */
export function buildAdHocAgentDef(
  settings: ChatSessionSettings,
  unifiedModelId: string
): AgentDefinition {
  const now = new Date().toISOString();
  const profile = resolveGeneralAgentProfile(settings);
  return {
    id: ADHOC_AGENT_ID,
    createdAt: now,
    updatedAt: now,
    name: "",
    description: "",
    systemPrompt: profile.systemPrompt,
    modelId: unifiedModelId,
    enabledInternalTools: profile.enabledInternalTools,
    enabledSkillIds: settings.enabledSkillIds,
    enabledMcpServerIds: settings.enabledMcpServerIds,
    connectorEnabled: settings.connectorEnabled,
    sandboxMode: settings.sandboxMode,
    workspacePath: settings.workspacePath,
    temperature: Number(settings.temperature) || 0,
    maxTokens: profile.maxTokens,
  };
}
