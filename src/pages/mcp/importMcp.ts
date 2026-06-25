import type { CreateInput } from "@/data/repository";
import type { McpServer, McpTransport } from "@/types";

export type ParsedMcpServer = CreateInput<McpServer>;

export interface ParseMcpResult {
  servers: ParsedMcpServer[];
  errors: string[];
}

function toStringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v == null) continue;
      out[k] = typeof v === "string" ? v : String(v);
    }
  }
  return out;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v) => v != null).map((v) => String(v));
  }
  return [];
}

function normalizeTransport(raw: unknown): McpTransport | null {
  if (typeof raw !== "string") return null;
  const v = raw.toLowerCase().replace(/[_-]/g, "");
  if (v === "stdio") return "stdio";
  if (v === "sse") return "sse";
  if (v === "http" || v === "streamablehttp" || v === "streamable") return "http";
  return null;
}

function parseEntry(name: string, entry: unknown): ParsedMcpServer | string {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return `${name}: invalid entry`;
  }
  const obj = entry as Record<string, unknown>;
  const command =
    typeof obj.command === "string" ? obj.command.trim() : "";
  const url =
    typeof obj.url === "string"
      ? obj.url.trim()
      : typeof obj.serverUrl === "string"
        ? (obj.serverUrl as string).trim()
        : typeof obj.endpoint === "string"
          ? (obj.endpoint as string).trim()
          : "";

  const explicit = normalizeTransport(obj.transport ?? obj.type);

  let transport: McpTransport;
  if (explicit) {
    transport = explicit;
  } else if (command) {
    transport = "stdio";
  } else if (url) {
    transport = "http";
  } else {
    return `${name}: missing "command" or "url"`;
  }

  if (transport === "stdio") {
    if (!command) return `${name}: stdio server requires "command"`;
    return {
      name,
      description:
        typeof obj.description === "string" ? obj.description : undefined,
      transport,
      command,
      args: toStringArray(obj.args),
      env: toStringRecord(obj.env),
      enabled: obj.enabled === false ? false : !(obj.disabled === true),
    };
  }

  if (!url) return `${name}: ${transport} server requires "url"`;
  return {
    name,
    description:
      typeof obj.description === "string" ? obj.description : undefined,
    transport,
    url,
    args: [],
    env: toStringRecord(obj.env),
    enabled: obj.enabled === false ? false : !(obj.disabled === true),
  };
}

/**
 * Parse an MCP JSON config into a list of servers.
 *
 * Supports the common `{"mcpServers": {...}}` shape (Claude Desktop / Cursor),
 * the VS Code `{"servers": {...}}` shape, a bare name→config map, and a single
 * server object (optionally carrying its own `name`).
 */
export function parseMcpJson(raw: string): ParseMcpResult {
  const text = raw.trim();
  if (!text) return { servers: [], errors: ["empty"] };

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return {
      servers: [],
      errors: [e instanceof Error ? e.message : "invalid JSON"],
    };
  }

  if (!data || typeof data !== "object") {
    return { servers: [], errors: ["expected a JSON object"] };
  }

  const root = data as Record<string, unknown>;
  const map =
    (root.mcpServers as Record<string, unknown> | undefined) ??
    (root.servers as Record<string, unknown> | undefined);

  const servers: ParsedMcpServer[] = [];
  const errors: string[] = [];

  if (map && typeof map === "object" && !Array.isArray(map)) {
    for (const [name, entry] of Object.entries(map)) {
      const result = parseEntry(name, entry);
      if (typeof result === "string") errors.push(result);
      else servers.push(result);
    }
    return { servers, errors };
  }

  // Single server object that carries its own name.
  if (typeof root.name === "string" && (root.command || root.url)) {
    const result = parseEntry(root.name, root);
    if (typeof result === "string") errors.push(result);
    else servers.push(result);
    return { servers, errors };
  }

  // Bare name→config map.
  const entries = Object.entries(root).filter(
    ([, v]) => v && typeof v === "object" && !Array.isArray(v)
  );
  if (entries.length === 0) {
    return { servers: [], errors: ['no "mcpServers" entries found'] };
  }
  for (const [name, entry] of entries) {
    const result = parseEntry(name, entry);
    if (typeof result === "string") errors.push(result);
    else servers.push(result);
  }
  return { servers, errors };
}
