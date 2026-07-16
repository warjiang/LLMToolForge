/**
 * Shared helpers for agent tool implementations.
 */

import type { AgentToolResult } from "@earendil-works/pi-agent-core";
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
