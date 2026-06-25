/**
 * Frontend bridge to the Rust MCP inspector commands.
 *
 * These commands spawn processes / open network connections from the Tauri
 * backend, so they only work in the desktop runtime. In the browser dev server
 * they reject early via {@link isInspectorSupported}.
 */
import { isLiveRequestSupported } from "@/lib/http";
import type { McpServer } from "@/types";

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
  [key: string]: unknown;
}

export interface McpResourceDef {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
  [key: string]: unknown;
}

export interface McpResourceTemplateDef {
  uriTemplate: string;
  name?: string;
  description?: string;
  mimeType?: string;
  [key: string]: unknown;
}

export interface McpPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface McpPromptDef {
  name: string;
  description?: string;
  arguments?: McpPromptArgument[];
  [key: string]: unknown;
}

export interface McpInspectSnapshot {
  protocolVersion: string | null;
  serverInfo: Record<string, unknown>;
  capabilities: Record<string, unknown>;
  instructions: string | null;
  tools: McpToolDef[];
  resources: McpResourceDef[];
  resourceTemplates: McpResourceTemplateDef[];
  prompts: McpPromptDef[];
}

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: unknown[];
  default?: unknown;
  title?: string;
  [key: string]: unknown;
}

/** Config payload understood by the Rust commands. */
export interface McpConnectConfig {
  transport: string;
  command?: string;
  args: string[];
  url?: string;
  env: Record<string, string>;
}

export function isInspectorSupported(): boolean {
  return isLiveRequestSupported();
}

export function toConnectConfig(server: McpServer): McpConnectConfig {
  return {
    transport: server.transport,
    command: server.command,
    args: server.args ?? [],
    url: server.url,
    env: server.env ?? {},
  };
}

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function inspectServer(
  server: McpServer
): Promise<McpInspectSnapshot> {
  return invoke<McpInspectSnapshot>("mcp_inspect", {
    config: toConnectConfig(server),
  });
}

export async function callTool(
  server: McpServer,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  return invoke<unknown>("mcp_call_tool", {
    config: toConnectConfig(server),
    name,
    arguments: args,
  });
}

export async function readResource(
  server: McpServer,
  uri: string
): Promise<unknown> {
  return invoke<unknown>("mcp_read_resource", {
    config: toConnectConfig(server),
    uri,
  });
}

export async function getPrompt(
  server: McpServer,
  name: string,
  args: Record<string, string>
): Promise<unknown> {
  return invoke<unknown>("mcp_get_prompt", {
    config: toConnectConfig(server),
    name,
    arguments: args,
  });
}
