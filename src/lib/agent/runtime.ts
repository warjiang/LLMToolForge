/**
 * Agent runtime: bind an `AgentDefinition` to the Pi `Agent` and bridge its
 * event stream to UI-facing callbacks.
 *
 * Reads live state from the app stores (Unified gateway config/models, skills,
 * MCP servers) so callers only pass a definition + callbacks. Desktop only —
 * the Unified gateway must be running.
 */

import { Agent } from "@earendil-works/pi-agent-core";
import type {
  AgentEvent,
  AgentMessage,
  AgentToolResult,
} from "@earendil-works/pi-agent-core";
import type { AgentDefinition } from "@/types";
import { useUnifiedStore } from "@/store/unified";
import { useSkillStore, useMcpStore } from "@/store";
import { buildPiModel } from "./model";
import { createUnifiedRuntime } from "./provider";
import { resolveAgent } from "./agentDefinition";
import { ensureGatewayFetch } from "./gatewayFetch";

export class GatewayUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayUnavailableError";
  }
}

export class ModelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelUnavailableError";
  }
}

export interface AgentToolStartInfo {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface AgentToolEndInfo {
  toolCallId: string;
  toolName: string;
  resultText: string;
  resultJson: unknown;
  isError: boolean;
}

export interface AgentRuntimeCallbacks {
  /** A new assistant turn began (new message bubble). */
  onAssistantStart?: () => void | Promise<void>;
  /** Accumulated text of the current assistant turn. */
  onAssistantDelta?: (text: string) => void | Promise<void>;
  /** Current assistant turn finished. */
  onAssistantEnd?: (text: string) => void | Promise<void>;
  onToolStart?: (info: AgentToolStartInfo) => void | Promise<void>;
  onToolEnd?: (info: AgentToolEndInfo) => void | Promise<void>;
  /** A fatal turn error (also ends the run). */
  onError?: (message: string) => void | Promise<void>;
  /** Run finished (idle). */
  onDone?: () => void | Promise<void>;
}

export interface AgentRuntime {
  prompt: (input: string) => Promise<void>;
  abort: () => void;
  waitForIdle: () => Promise<void>;
  /** MCP servers that failed to inspect while building tools. */
  mcpErrors: { server: string; error: string }[];
  /** MCP servers still warming up in the background (skipped this turn). */
  mcpPending: string[];
}

function gatewayBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}/v1`;
}

/** Extract plain text from an assistant message's content blocks. */
function assistantText(message: AgentMessage): string {
  if (message.role !== "assistant") return "";
  return message.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");
}

function resultToText(result: AgentToolResult<unknown> | undefined): string {
  if (!result?.content) return "";
  return result.content
    .map((c) => (c.type === "text" ? c.text : `[${c.type}]`))
    .join("\n");
}

/**
 * Create a runtime for `def`. Throws `GatewayUnavailableError` /
 * `ModelUnavailableError` when prerequisites are missing.
 */
export async function createAgentRuntime(
  def: AgentDefinition,
  callbacks: AgentRuntimeCallbacks
): Promise<AgentRuntime> {
  let unified = useUnifiedStore.getState();
  if (!unified.supported) {
    throw new GatewayUnavailableError("Agent 运行时仅在桌面端可用");
  }
  if (!unified.status?.running) {
    // Auto-start the local gateway on demand instead of bouncing the user to
    // the Unified page. `start()` swallows errors into store state, so re-read.
    await unified.start();
    unified = useUnifiedStore.getState();
    if (!unified.status?.running) {
      throw new GatewayUnavailableError(
        unified.error
          ? `本地 Unified 网关启动失败：${unified.error}`
          : "本地 Unified 网关未启动"
      );
    }
  }

  const exposed = unified.models.find((m) => m.id === def.modelId);
  if (!exposed) {
    throw new ModelUnavailableError(
      `未找到模型 "${def.modelId}"，请在 Unified 网关中启用`
    );
  }

  const baseUrl = gatewayBaseUrl(unified.config.port);
  await ensureGatewayFetch();
  const piModel = buildPiModel(exposed, {
    baseUrl,
    maxTokens: def.maxTokens,
  });
  const { streamFn } = createUnifiedRuntime(
    [piModel],
    baseUrl,
    unified.config.localKey
  );

  const resolved = await resolveAgent(def, {
    skills: useSkillStore.getState().items,
    mcpServers: useMcpStore.getState().items,
  });

  console.debug("[agent] runtime built", {
    modelId: def.modelId,
    baseUrl,
    port: unified.config.port,
    statusRunning: unified.status?.running,
    tools: resolved.tools.map((tl) => tl.name),
    toolCount: resolved.tools.length,
    mcpErrors: resolved.mcpErrors,
    mcpPending: resolved.mcpPending,
    systemPromptLen: resolved.systemPrompt.length,
  });

  const agent = new Agent({
    initialState: {
      systemPrompt: resolved.systemPrompt,
      model: piModel,
      tools: resolved.tools,
    },
    streamFn,
  });

  agent.subscribe(async (event: AgentEvent) => {
    console.debug("[agent] event", event.type, {
      role: (event as { message?: AgentMessage }).message?.role,
    });
    switch (event.type) {
      case "message_start":
        if ((event.message as AgentMessage).role === "assistant") {
          await callbacks.onAssistantStart?.();
        }
        break;
      case "message_update":
        if ((event.message as AgentMessage).role === "assistant") {
          await callbacks.onAssistantDelta?.(assistantText(event.message));
        }
        break;
      case "message_end":
        if ((event.message as AgentMessage).role === "assistant") {
          const msg = event.message as Extract<
            AgentMessage,
            { role: "assistant" }
          >;
          console.debug("[agent] assistant message_end", {
            stopReason: msg.stopReason,
            errorMessage: msg.errorMessage,
            contentTypes: msg.content.map((c) => c.type),
            text: assistantText(event.message).slice(0, 120),
          });
          if (msg.errorMessage) {
            await callbacks.onError?.(msg.errorMessage);
          } else {
            await callbacks.onAssistantEnd?.(assistantText(event.message));
          }
        }
        break;
      case "tool_execution_start":
        await callbacks.onToolStart?.({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        });
        break;
      case "tool_execution_end":
        await callbacks.onToolEnd?.({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          resultText: resultToText(event.result),
          resultJson: event.result?.details,
          isError: event.isError,
        });
        break;
      case "agent_end":
        await callbacks.onDone?.();
        break;
      default:
        break;
    }
  });

  return {
    prompt: async (input: string) => {
      try {
        await agent.prompt(input);
      } catch (err) {
        console.error("[agent] prompt threw", err);
        throw err;
      }
    },
    abort: () => agent.abort(),
    waitForIdle: () => agent.waitForIdle(),
    mcpErrors: resolved.mcpErrors,
    mcpPending: resolved.mcpPending,
  };
}
