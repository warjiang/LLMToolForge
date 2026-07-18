/**
 * Shared helpers for agent tool implementations.
 */

import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TextContent } from "@earendil-works/pi-ai";

/** True when running inside the Tauri desktop shell. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Thin wrapper around the Tauri `invoke` API (lazily imported). */
export async function invoke<T>(
  cmd: string,
  args: Record<string, unknown>
): Promise<T> {
  if (!isTauri()) {
    throw new Error(`命令 ${cmd} 仅在桌面端可用`);
  }
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

export function text(value: string): TextContent {
  return { type: "text", text: value };
}

export { stripAnsi } from "@/lib/utils";

/** Build a simple text tool result. */
export function textResult<T>(value: string, details: T): AgentToolResult<T> {
  return { content: [text(value)], details };
}

/**
 * Wrap a tool so its `execute` settles as soon as the run's abort signal fires,
 * even if the underlying operation ignores the signal.
 *
 * pi's agent loop `await`s `tool.execute(...)` and only checks `signal.aborted`
 * *after* it resolves. A tool that never observes the signal (most MCP / IPC /
 * network calls) therefore blocks the whole loop, so `agent.abort()` cannot
 * settle the run and the session looks frozen mid-tool. Racing execute against
 * the signal makes every tool interruptible at the loop boundary; the wrapped
 * call still receives the signal so signal-aware tools can also stop their work.
 */
export function makeToolAbortable(tool: AgentTool): AgentTool {
  const original = tool.execute.bind(tool);
  return {
    ...tool,
    execute: (toolCallId, params, signal, onUpdate) => {
      if (!signal) return original(toolCallId, params, signal, onUpdate);
      if (signal.aborted) return Promise.reject(abortError());
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(abortError());
        signal.addEventListener("abort", onAbort, { once: true });
        Promise.resolve(original(toolCallId, params, signal, onUpdate)).then(
          (value) => {
            signal.removeEventListener("abort", onAbort);
            resolve(value);
          },
          (err) => {
            signal.removeEventListener("abort", onAbort);
            reject(err);
          }
        );
      });
    },
  };
}

function abortError(): Error {
  try {
    return new DOMException("Tool execution aborted", "AbortError");
  } catch {
    const err = new Error("Tool execution aborted");
    err.name = "AbortError";
    return err;
  }
}
