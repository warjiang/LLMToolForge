import type { BuiltinMcpKind, McpServer } from "@/types";

/**
 * Ship-with-the-app MCP tools presented as built-in cards on the MCP page.
 *
 * They surface as regular {@link McpServer} objects (stable ids) so they flow
 * through `enabledMcpServerIds` and the normal tool-building path, but they are
 * not persisted in the synced repository — their mutable state (enabled /
 * installed) lives in the local {@link useBuiltinMcpStore}.
 *
 * - `playwright` is a real stdio server (`npx @playwright/mcp`) that must be
 *   installed (a one-shot `npx` warm-up) before it can be enabled.
 * - `web-search` / `web-fetch` are local Rust implementations (no subprocess,
 *   no install) handled directly in `buildMcpTools`.
 */

export interface BuiltinInstallSpec {
  /** Package manager runner used for the one-shot install/warm-up. */
  manager: "npx" | "uvx";
  /** Arguments passed to the runner (e.g. ["-y", "@playwright/mcp@latest"]). */
  args: string[];
}

export interface BuiltinMcpDef {
  kind: BuiltinMcpKind;
  id: string;
  name: string;
  description: string;
  /** How tools are produced: a spawned stdio server or a local Rust command. */
  runtime: "stdio" | "local";
  transport: McpServer["transport"];
  command?: string;
  args: string[];
  /** Present when the builtin needs a one-shot install before it can be used. */
  install?: BuiltinInstallSpec;
}

export const BUILTIN_MCP_DEFS: BuiltinMcpDef[] = [
  {
    kind: "playwright",
    id: "builtin-playwright",
    name: "Playwright",
    description:
      "浏览器自动化 MCP：驱动真实浏览器进行导航、点击、抓取与截图。首次使用需安装。",
    runtime: "stdio",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    install: { manager: "npx", args: ["-y", "@playwright/mcp@latest", "--help"] },
  },
  {
    kind: "web-search",
    id: "builtin-web-search",
    name: "Web Search",
    description:
      "本地网页搜索：抓取搜索引擎结果并返回标题、链接与摘要，无需 API Key。",
    runtime: "local",
    transport: "stdio",
    args: [],
  },
  {
    kind: "web-fetch",
    id: "builtin-web-fetch",
    name: "Web Fetch",
    description:
      "本地网页抓取：读取公开网页的正文与链接，支持在应用内浏览器渲染登录/JS 页面。",
    runtime: "local",
    transport: "stdio",
    args: [],
  },
];

const BY_ID = new Map(BUILTIN_MCP_DEFS.map((d) => [d.id, d]));
const BY_KIND = new Map(BUILTIN_MCP_DEFS.map((d) => [d.kind, d]));

export function getBuiltinDef(id: string): BuiltinMcpDef | undefined {
  return BY_ID.get(id);
}

export function getBuiltinDefByKind(
  kind: BuiltinMcpKind
): BuiltinMcpDef | undefined {
  return BY_KIND.get(kind);
}

export function isBuiltinId(id: string): boolean {
  return BY_ID.has(id);
}

/** Local builtins (no subprocess, no install) resolve their tools in-process. */
export function isLocalBuiltin(def: BuiltinMcpDef): boolean {
  return def.runtime === "local";
}

/** Whether a builtin requires a one-shot install before it can be enabled. */
export function builtinNeedsInstall(def: BuiltinMcpDef): boolean {
  return def.install !== undefined;
}
