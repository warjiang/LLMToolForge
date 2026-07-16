/**
 * Local builtin MCP tools (`web-search`, `web-fetch`).
 *
 * These ship with the app and run entirely in-process (Rust commands) instead
 * of spawning an MCP subprocess. They are exposed under the same
 * `mcp__<slug>__<tool>` naming as real MCP tools so the model sees a consistent
 * surface, and are wired in through `buildMcpTools`.
 */

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { McpServer } from "@/types";
import { invoke, text } from "./shared";
import { stripAnsi } from "@/lib/utils";

interface WebSearchItem {
  title: string;
  url: string;
  snippet: string;
}

interface WebSearchResponse {
  query: string;
  results: WebSearchItem[];
}

interface WebFetchLink {
  text: string;
  href: string;
}

interface WebFetchResponse {
  url: string;
  finalUrl: string;
  status: number;
  title: string;
  text: string;
  links: WebFetchLink[];
  truncated: boolean;
  mode: string;
}

function webSearchTool(): AgentTool {
  return {
    name: "mcp__web-search__search",
    label: "Web Search: search",
    description:
      "在网络上搜索并返回结果列表（标题、链接、摘要）。用于查找与问题相关的网页、文章或资料，再配合 web-fetch 读取具体页面。无需 API Key。",
    parameters: Type.Object({
      query: Type.String({ description: "搜索关键词。" }),
      limit: Type.Optional(
        Type.Number({ description: "返回结果条数（默认 8，最大 20）。" })
      ),
    }) as unknown as AgentTool["parameters"],
    execute: async (_id: string, params: unknown) => {
      const p = (params ?? {}) as { query?: string; limit?: number };
      const res = await invoke<WebSearchResponse>("web_search", {
        req: { query: p.query ?? "", limit: p.limit },
      });
      if (res.results.length === 0) {
        return {
          content: [text(`未找到与「${res.query}」相关的结果。`)],
          details: res,
        };
      }
      const body = res.results
        .map(
          (r, i) =>
            `${i + 1}. ${stripAnsi(r.title) || r.url}\n   ${r.url}` +
            (r.snippet ? `\n   ${stripAnsi(r.snippet)}` : "")
        )
        .join("\n\n");
      return {
        content: [text(`「${res.query}」的搜索结果：\n\n${body}`)],
        details: res,
      };
    },
  };
}

function webFetchTool(): AgentTool {
  return {
    name: "mcp__web-fetch__fetch",
    label: "Web Fetch: fetch",
    description:
      "读取一个公开网页并返回其正文文本与链接。用于查看搜索结果、文章、帖子的实际内容。默认无头 HTTP 抓取；对需要登录或 JS 渲染的页面（如知乎、小红书、公众号）设置 render=true，将用应用内浏览器的真实登录态加载后再提取。",
    parameters: Type.Object({
      url: Type.String({
        description: "要抓取的完整 URL（无协议时默认 https://）。",
      }),
      render: Type.Optional(
        Type.Boolean({
          description:
            "用应用内浏览器（真实登录态、执行页面 JS）加载，而非无头 HTTP。失败时自动回退 HTTP。",
        })
      ),
      maxChars: Type.Optional(
        Type.Number({ description: "返回正文的最大字符数（默认 40000）。" })
      ),
    }) as unknown as AgentTool["parameters"],
    execute: async (_id: string, params: unknown) => {
      const p = (params ?? {}) as {
        url?: string;
        render?: boolean;
        maxChars?: number;
      };
      const res = await invoke<WebFetchResponse>("web_fetch", {
        req: {
          url: p.url ?? "",
          render: p.render ?? false,
          maxChars: p.maxChars,
        },
      });
      const header =
        `# ${res.title || "(untitled)"}\n` +
        `URL: ${res.finalUrl} (HTTP ${res.status}, mode=${res.mode})\n`;
      const linkLines =
        res.links.length > 0
          ? "\n\nLinks:\n" +
            res.links
              .slice(0, 40)
              .map((l) => `- ${l.text || l.href} -> ${l.href}`)
              .join("\n")
          : "";
      const suffix = res.truncated ? "\n…(内容已截断)" : "";
      return {
        content: [text(header + "\n" + res.text + suffix + linkLines)],
        details: res,
      };
    },
  };
}

/** Build the local tools for a builtin server, or [] if it isn't a local one. */
export function buildLocalBuiltinTools(server: McpServer): AgentTool[] {
  switch (server.builtin) {
    case "web-search":
      return [webSearchTool()];
    case "web-fetch":
      return [webFetchTool()];
    default:
      return [];
  }
}
