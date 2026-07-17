/**
 * External agent runtime: drive a framework-based agent subprocess (Python /
 * Node) that speaks the Agent Adapter Protocol (AAP), and bridge its event
 * stream to the exact same `AgentRuntimeCallbacks` the built-in Pi runtime uses.
 *
 * This is the crux of "interaction reuse": `AgentChatView` programs against the
 * `AgentRuntime` interface, so an external agent is just another `AgentRuntime`
 * implementation whose events happen to originate from a subprocess.
 *
 * Desktop only — requires the Tauri `agent_*` commands and a running Unified
 * gateway (auto-started on demand, mirroring the built-in runtime).
 */

import type { AgentDefinition, ExternalAgentSpec } from "@/types";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { useUnifiedStore } from "@/store/unified";
import { useSkillStore, getEffectiveMcpServers } from "@/store";
import { resolveAgent } from "./agentDefinition";
import {
  GatewayUnavailableError,
  ModelUnavailableError,
  type AgentRuntime,
  type AgentRuntimeCallbacks,
  type AgentRuntimeOptions,
} from "./runtime";
import {
  AAP_PROTOCOL_VERSION,
  encodeHostMessage,
  asAgentEvent,
  type AapAgentEvent,
  type AapHistoryMessage,
  type AapHostMessage,
  type AapHostToolSpec,
} from "./aap/protocol";

function gatewayBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}/v1`;
}

/** Resolve the interpreter/program + args for an external agent spec. */
function resolveProgram(spec: ExternalAgentSpec): {
  program: string;
  entryArgs: string[];
} {
  const entry = spec.entry?.trim() || "main";
  const abs = entry.startsWith("/")
    ? entry
    : `${spec.packageDir.replace(/\/+$/, "")}/${entry}`;
  if (spec.runtime === "python") {
    // uv-created venv interpreter when available; else system python3.
    const program = spec.envPath?.trim()
      ? `${spec.envPath.replace(/\/+$/, "")}/bin/python`
      : "python3";
    return { program, entryArgs: [abs] };
  }
  // Node: the interpreter is system node; the isolated env only affects module
  // resolution (node_modules under the package dir).
  return { program: "node", entryArgs: [abs] };
}

let runCounter = 0;
function nextRunId(defId: string): string {
  runCounter += 1;
  return `agent-${defId}-${Date.now()}-${runCounter}`;
}

/**
 * Build a stable User-Agent string for an external agent's Unified requests, so
 * the call monitor can attribute traffic to a specific installed agent. Kept
 * ASCII + header-safe (no control chars / newlines).
 */
function buildAgentUserAgent(spec: ExternalAgentSpec): string {
  const safe = (s: string) => s.replace(/[^\x20-\x7E]/g, "").replace(/[()]/g, "").trim();
  const id = safe(spec.packageId || "agent") || "agent";
  const parts = [spec.framework, spec.runtime].filter(Boolean).map((p) => safe(String(p)));
  const suffix = parts.length ? ` (${parts.join("; ")})` : "";
  return `LLMToolForge-Agent/${id}${suffix}`;
}

/** Flatten a pi `AgentToolResult` content array into plain text. */
function resultToText(result: AgentToolResult<unknown> | undefined): string {
  if (!result?.content) return "";
  return result.content
    .map((c) => (c.type === "text" ? c.text : `[${c.type}]`))
    .join("\n");
}

/** Advertise a resolved host tool to the agent as a JSON-schema tool spec. */
function toHostToolSpec(tool: AgentTool): AapHostToolSpec {
  const t = tool as unknown as {
    name: string;
    description?: string;
    parameters?: unknown;
  };
  return {
    name: t.name,
    description: t.description ?? "",
    parameters: t.parameters ?? { type: "object", properties: {} },
  };
}

/**
 * Create an `AgentRuntime` backed by an external agent subprocess.
 *
 * Signature intentionally matches `createAgentRuntime` so `AgentChatView` can
 * branch on `def.kind` and otherwise treat both uniformly.
 */
export async function createExternalAgentRuntime(
  def: AgentDefinition,
  callbacks: AgentRuntimeCallbacks,
  options: AgentRuntimeOptions = {}
): Promise<AgentRuntime> {
  if (def.kind !== "external" || !def.external) {
    throw new Error("createExternalAgentRuntime requires an external AgentDefinition");
  }
  const spec = def.external;

  let unified = useUnifiedStore.getState();
  if (!unified.supported) {
    throw new GatewayUnavailableError("Agent 运行时仅在桌面端可用");
  }
  if (!unified.status?.running) {
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
  const localKey = unified.config.localKey ?? "";

  // A stable User-Agent that lets the call monitor attribute Unified requests to
  // this specific external agent (package id + framework + runtime).
  const userAgent = buildAgentUserAgent(spec);

  // --- Phase 2 reverse bridge: resolve the same host tools the built-in agent
  // would get (internal bash/fs/grep/web_fetch + skills + MCP), so the external
  // agent can call back into the app through the identical sandbox + approval
  // path. Tool execution reuses each tool's `.execute`, so no logic is copied.
  const resolved = await resolveAgent(def, {
    skills: useSkillStore.getState().items,
    mcpServers: getEffectiveMcpServers(),
    workspacePath: options.workspacePath,
    requestCheckpoint: options.requestCheckpoint,
    requestAsk: options.requestAsk,
  });
  const hostToolMap = new Map<string, AgentTool>(
    resolved.tools.map((t) => [(t as unknown as { name: string }).name, t])
  );
  const hostToolSpecs: AapHostToolSpec[] = resolved.tools.map(toHostToolSpec);

  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");

  const runId = nextRunId(def.id);

  // --- per-turn assistant/reasoning accumulation (matches Pi runtime contract) ---
  let acc = "";
  let reasoningAcc = "";

  // --- idle signalling for waitForIdle() ---
  let idleResolve: (() => void) | null = null;
  let idlePromise: Promise<void> = Promise.resolve();
  const settleIdle = () => {
    if (idleResolve) {
      idleResolve();
      idleResolve = null;
    }
  };

  const send = (msg: AapHostMessage) =>
    invoke("agent_send", { runId, line: encodeHostMessage(msg) });

  /**
   * Execute a host tool the agent requested, surfacing it in the chat UI as a
   * normal tool call, then reply with the correlated `host_tool_result`. All
   * gating (sandbox mode, human checkpoints/asks) is inherited from the tool's
   * own `execute`, so external agents get the exact same guarantees.
   */
  const handleHostToolCall = async (
    callId: string,
    toolName: string,
    args: unknown
  ): Promise<void> => {
    const toolCallId = `host-${callId}`;
    await callbacks.onToolStart?.({ toolCallId, toolName, args });
    const tool = hostToolMap.get(toolName);
    if (!tool) {
      const message = `未知的宿主工具：${toolName}`;
      await callbacks.onToolEnd?.({
        toolCallId,
        toolName,
        resultText: message,
        resultJson: undefined,
        isError: true,
      });
      await send({
        type: "host_tool_result",
        callId,
        toolName,
        resultText: message,
        isError: true,
      });
      return;
    }
    try {
      const exec = (tool as unknown as {
        execute: (id: string, params: unknown) => Promise<AgentToolResult<unknown>>;
      }).execute;
      const result = await exec(toolCallId, args ?? {});
      const resultText = resultToText(result);
      await callbacks.onToolEnd?.({
        toolCallId,
        toolName,
        resultText,
        resultJson: (result as { details?: unknown })?.details,
        isError: false,
      });
      await send({
        type: "host_tool_result",
        callId,
        toolName,
        resultText,
        resultJson: (result as { details?: unknown })?.details,
        isError: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await callbacks.onToolEnd?.({
        toolCallId,
        toolName,
        resultText: message,
        resultJson: undefined,
        isError: true,
      });
      await send({
        type: "host_tool_result",
        callId,
        toolName,
        resultText: message,
        isError: true,
      });
    }
  };

  const handleEvent = async (evt: AapAgentEvent) => {
    switch (evt.type) {
      case "ready":
        break;
      case "assistant_start":
        acc = "";
        reasoningAcc = "";
        await callbacks.onAssistantStart?.();
        break;
      case "assistant_delta":
        acc += evt.delta ?? "";
        await callbacks.onAssistantDelta?.(acc);
        break;
      case "reasoning_delta":
        reasoningAcc += evt.delta ?? "";
        await callbacks.onReasoningDelta?.(reasoningAcc);
        break;
      case "assistant_end":
        await callbacks.onAssistantEnd?.(evt.text ?? acc);
        break;
      case "tool_start":
        await callbacks.onToolStart?.({
          toolCallId: evt.toolCallId,
          toolName: evt.toolName,
          args: evt.args,
        });
        break;
      case "tool_end":
        await callbacks.onToolEnd?.({
          toolCallId: evt.toolCallId,
          toolName: evt.toolName,
          resultText: evt.resultText ?? "",
          resultJson: evt.resultJson,
          isError: Boolean(evt.isError),
        });
        break;
      case "host_tool_call":
        await handleHostToolCall(evt.callId, evt.toolName, evt.args);
        break;
      case "error":
        await callbacks.onError?.(evt.message ?? "agent error");
        settleIdle();
        await callbacks.onDone?.();
        break;
      case "done":
        settleIdle();
        await callbacks.onDone?.();
        break;
      default:
        break;
    }
  };

  const unlisten = await listen<{ runId: string; event: unknown }>(
    `agent://event/${runId}`,
    (e) => {
      const payload = e.payload;
      if (!payload || payload.runId !== runId) return;
      // Synthetic host-side exit notification (process died).
      if (
        payload.event &&
        typeof payload.event === "object" &&
        (payload.event as { type?: string }).type === "exit"
      ) {
        void callbacks.onError?.("agent 进程已退出");
        settleIdle();
        void callbacks.onDone?.();
        return;
      }
      const evt = asAgentEvent(payload.event);
      if (evt) void handleEvent(evt);
    }
  );

  // Spawn the subprocess with Unified credentials injected via env.
  const { program, entryArgs } = resolveProgram(spec);
  await invoke("agent_spawn", {
    runId,
    spec: {
      program,
      args: entryArgs,
      cwd: spec.packageDir,
      env: {
        UNIFIED_BASE_URL: baseUrl,
        UNIFIED_API_KEY: localKey,
        UNIFIED_MODEL: def.modelId,
        UNIFIED_USER_AGENT: userAgent,
        // Ensure node resolves the package's own node_modules first.
        ...(spec.runtime === "node" && spec.envPath
          ? { NODE_PATH: `${spec.envPath.replace(/\/+$/, "")}/node_modules` }
          : {}),
      },
    },
  });

  // Hand the agent its model/gateway config + prior conversation.
  const history: AapHistoryMessage[] = (options.seedHistory ?? [])
    .filter((m) => (m.content ?? "").trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content }));
  await send({
    type: "init",
    protocolVersion: AAP_PROTOCOL_VERSION,
    config: {
      baseUrl,
      localKey,
      model: def.modelId,
      systemPrompt: def.systemPrompt ?? "",
      temperature: def.temperature,
      maxTokens: def.maxTokens,
      userAgent,
    },
    history,
    hostTools: hostToolSpecs,
  });

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    void unlisten();
    void invoke("agent_kill", { runId }).catch(() => {});
  };

  return {
    prompt: async (input: string) => {
      idlePromise = new Promise<void>((resolve) => {
        idleResolve = resolve;
      });
      await send({ type: "prompt", input });
    },
    abort: () => {
      void send({ type: "abort" }).catch(() => {});
      settleIdle();
    },
    waitForIdle: () => idlePromise,
    dispose,
    mcpErrors: [],
    mcpPending: [],
  };
}
