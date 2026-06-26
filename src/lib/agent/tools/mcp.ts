/**
 * Wrap external MCP server tools as Pi `AgentTool`s.
 *
 * Pi has no built-in MCP. For each enabled server we inspect its tool list
 * (`mcp_inspect`) and map every tool to an `AgentTool` whose `execute` calls
 * `mcp_call_tool`. The MCP `inputSchema` (JSON Schema) is passed straight
 * through as the tool parameters — pi-ai's validator accepts raw JSON Schema.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@earendil-works/pi-ai";
import type { McpServer } from "@/types";
import { callTool, inspectServer, type McpToolDef, type McpInspectSnapshot } from "@/lib/mcpInspector";
import { text } from "./shared";

/** Separator between the server slug and the tool name in the exposed name. */
const NAME_SEP = "__";

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "mcp";
}

function emptySchema(): TSchema {
  return { type: "object", properties: {} } as unknown as TSchema;
}

/** Best-effort flatten of an MCP tool result into readable text. */
function formatMcpResult(result: unknown): string {
  if (result == null) return "(无返回)";
  if (typeof result === "string") return result;
  if (typeof result === "object") {
    const obj = result as Record<string, unknown>;
    const content = obj.content;
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const item of content) {
        if (item && typeof item === "object") {
          const c = item as Record<string, unknown>;
          if (typeof c.text === "string") {
            parts.push(c.text);
            continue;
          }
          if (c.type === "image") {
            parts.push("[image]");
            continue;
          }
        }
        parts.push(JSON.stringify(item));
      }
      if (parts.length) return parts.join("\n");
    }
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function isErrorResult(result: unknown): boolean {
  return Boolean(
    result &&
      typeof result === "object" &&
      (result as Record<string, unknown>).isError === true
  );
}

function toAgentTool(server: McpServer, def: McpToolDef): AgentTool {
  const exposedName = `mcp${NAME_SEP}${slug(server.name || server.id)}${NAME_SEP}${slug(def.name)}`;
  const parameters = (def.inputSchema as unknown as TSchema) ?? emptySchema();
  return {
    name: exposedName,
    label: `${server.name}: ${def.name}`,
    description:
      def.description ||
      `MCP tool "${def.name}" from server "${server.name}".`,
    parameters,
    execute: async (_id, params) => {
      const result = await callTool(
        server,
        def.name,
        (params ?? {}) as Record<string, unknown>
      );
      if (isErrorResult(result)) {
        throw new Error(formatMcpResult(result));
      }
      return {
        content: [text(formatMcpResult(result))],
        details: { server: server.name, tool: def.name, result },
      };
    },
  };
}

export interface BuildMcpToolsResult {
  tools: AgentTool[];
  /** Servers that failed to inspect, with the error message. */
  errors: { server: string; error: string }[];
  /** Servers still warming up in the background (skipped this turn). */
  pending: string[];
}

/** Hard cap on a single server's inspect before it is considered failed. */
const INSPECT_TIMEOUT_MS = 30_000;
/** How long the agent build waits for a not-yet-ready server before skipping it. */
const BUILD_GRACE_MS = 8_000;
/** Don't re-probe a server that just failed for this long (avoids re-spawn storms). */
const ERROR_BACKOFF_MS = 60_000;

type WarmStatus = "pending" | "ready" | "error";

interface WarmEntry {
  signature: string;
  status: WarmStatus;
  promise: Promise<McpInspectSnapshot>;
  snapshot?: McpInspectSnapshot;
  error?: string;
  /** When the inspect started (used to charge already-elapsed grace). */
  startedAt: number;
  /** When the entry reached a terminal (ready/error) state. */
  settledAt: number;
}

/** Background inspect cache, keyed by server id. */
const warmCache = new Map<string, WarmEntry>();

/** Stable identity of a server config; a change invalidates the cached entry. */
function serverSignature(s: McpServer): string {
  const env = Object.entries(s.env ?? {}).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  return JSON.stringify([
    s.transport,
    s.command ?? "",
    s.args ?? [],
    s.url ?? "",
    env,
  ]);
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} 超时（${Math.round(ms / 1000)}s）`)),
      ms
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Ensure a background inspect is in flight (or cached) for `server`, returning
 * the cache entry. Reuses a healthy/ready entry, retries an errored one only
 * after a backoff, and never blocks the caller — the inspect runs detached.
 */
function warmServer(server: McpServer): WarmEntry {
  const signature = serverSignature(server);
  const existing = warmCache.get(server.id);
  if (existing && existing.signature === signature) {
    const recentlyFailed =
      existing.status === "error" &&
      Date.now() - existing.settledAt < ERROR_BACKOFF_MS;
    if (existing.status === "pending" || existing.status === "ready" || recentlyFailed) {
      return existing;
    }
  }

  const entry: WarmEntry = {
    signature,
    status: "pending",
    startedAt: Date.now(),
    settledAt: 0,
    promise: undefined as unknown as Promise<McpInspectSnapshot>,
  };
  entry.promise = withTimeout(
    inspectServer(server),
    INSPECT_TIMEOUT_MS,
    `连接 MCP 服务器「${server.name}」`
  ).then(
    (snapshot) => {
      // Only record if this entry is still the current one for the server.
      if (warmCache.get(server.id) === entry) {
        entry.status = "ready";
        entry.snapshot = snapshot;
        entry.settledAt = Date.now();
      }
      return snapshot;
    },
    (error) => {
      if (warmCache.get(server.id) === entry) {
        entry.status = "error";
        entry.error = error instanceof Error ? error.message : String(error);
        entry.settledAt = Date.now();
      }
      throw error;
    }
  );
  // Swallow unhandled rejection; consumers read `entry.status`/`entry.error`.
  entry.promise.catch(() => {});
  warmCache.set(server.id, entry);
  return entry;
}

/**
 * Kick off background inspection for the given servers without waiting. Call
 * this when the chat view mounts or the enabled MCP set changes so working
 * servers are ready (cached) by the time the user sends a message.
 */
export function prewarmMcpServers(servers: McpServer[]): void {
  for (const server of servers) {
    try {
      warmServer(server);
    } catch {
      // warmServer never throws synchronously, but stay defensive.
    }
  }
}

/** Wait for `entry` to settle, but at most `graceMs` from when warming began. */
async function awaitSettled(entry: WarmEntry, graceMs: number): Promise<void> {
  if (entry.status !== "pending") return;
  const remaining = graceMs - (Date.now() - entry.startedAt);
  if (remaining <= 0) return; // already warmed past the grace window
  await Promise.race([
    entry.promise.then(
      () => undefined,
      () => undefined
    ),
    new Promise<void>((resolve) => setTimeout(resolve, remaining)),
  ]);
}

/**
 * Build tools from each enabled MCP server's cached inspection. Servers are
 * warmed in the background; this only waits a short grace period for any that
 * are not yet ready. A slow or broken server is skipped (reported as pending or
 * an error) so it never blocks the agent turn or the healthy servers.
 */
export async function buildMcpTools(
  servers: McpServer[]
): Promise<BuildMcpToolsResult> {
  const tools: AgentTool[] = [];
  const errors: { server: string; error: string }[] = [];
  const pending: string[] = [];

  const entries = servers.map((server) => ({ server, entry: warmServer(server) }));

  // Give not-yet-ready servers a brief, shared grace window to settle.
  await Promise.all(
    entries.map(({ entry }) => awaitSettled(entry, BUILD_GRACE_MS))
  );

  for (const { server, entry } of entries) {
    if (entry.status === "ready" && entry.snapshot) {
      for (const def of entry.snapshot.tools) {
        tools.push(toAgentTool(server, def));
      }
    } else if (entry.status === "error") {
      errors.push({ server: server.name, error: entry.error ?? "连接失败" });
    } else {
      pending.push(server.name);
    }
  }

  return { tools, errors, pending };
}
