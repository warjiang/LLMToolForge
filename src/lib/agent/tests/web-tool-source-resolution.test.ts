import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentDefinition, McpServer } from "@/types";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { resolveAgent } from "../agentDefinition";
import {
  normalizeAgentWebToolSource,
  normalizeEnabledMcpServerIds,
  normalizeWebToolSource,
} from "../webToolSource";

const { buildMcpToolsMock } = vi.hoisted(() => ({
  buildMcpToolsMock: vi.fn(),
}));

vi.mock("../tools/mcp", () => ({
  buildMcpTools: buildMcpToolsMock,
}));

function server(
  id: string,
  patch: Partial<McpServer> = {}
): McpServer {
  return {
    id,
    createdAt: "2026-10-21T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
    name: id,
    transport: "stdio",
    args: [],
    env: {},
    enabled: true,
    installed: true,
    ...patch,
  };
}

function definition(
  patch: Partial<AgentDefinition> = {}
): AgentDefinition {
  return {
    id: "agent",
    createdAt: "2026-10-21T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
    name: "Agent",
    description: "",
    systemPrompt: "",
    modelId: "connection/model",
    enabledInternalTools: ["read"],
    enabledSkillIds: [],
    enabledMcpServerIds: [],
    sandboxMode: "workspace-write",
    workspacePath: "",
    temperature: 0,
    maxTokens: 4096,
    ...patch,
  };
}

function tool(name: string): AgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [] }),
  } as unknown as AgentTool;
}

function resolvedToolNames(result: Awaited<ReturnType<typeof resolveAgent>>) {
  return result.tools.map((item) => item.name);
}

describe("Web tool source normalization", () => {
  beforeEach(() => {
    buildMcpToolsMock.mockImplementation(async (servers: McpServer[]) => ({
      tools: servers.map((item) => tool(`mcp__${item.id}`)),
      errors: [],
      pending: [],
    }));
  });

  test("accepts each persisted Web source variant", () => {
    expect(normalizeWebToolSource({ kind: "builtin" })).toEqual({
      kind: "builtin",
    });
    expect(
      normalizeWebToolSource({ kind: "mcp", serverId: "search-server" })
    ).toEqual({ kind: "mcp", serverId: "search-server" });
    expect(normalizeWebToolSource({ kind: "off" })).toEqual({ kind: "off" });
  });

  test("falls back to off for absent and malformed values", () => {
    expect(normalizeWebToolSource(undefined)).toEqual({ kind: "off" });
    expect(normalizeWebToolSource({ kind: "mcp", serverId: "" })).toEqual({
      kind: "off",
    });
    expect(normalizeWebToolSource({ kind: "mcp", serverId: 42 })).toEqual({
      kind: "off",
    });
    expect(normalizeWebToolSource({ kind: "other" })).toEqual({ kind: "off" });
  });

  test("migrates legacy internal fetch and bundled MCP ids to builtin", () => {
    expect(
      normalizeAgentWebToolSource({
        enabledInternalTools: ["read", "web_fetch"],
        enabledMcpServerIds: [],
      })
    ).toEqual({ kind: "builtin" });
    expect(
      normalizeAgentWebToolSource({
        enabledInternalTools: ["read"],
        enabledMcpServerIds: ["builtin-web-search"],
      })
    ).toEqual({ kind: "builtin" });
  });

  test("migrates an absent reusable-agent source to its sole eligible candidate", () => {
    const candidate = server("research-web", {
      webToolSourceCandidate: true,
    });

    expect(
      normalizeAgentWebToolSource(
        {
          enabledInternalTools: ["read"],
          enabledMcpServerIds: ["research-web"],
        },
        [candidate]
      )
    ).toEqual({ kind: "mcp", serverId: "research-web" });
    expect(
      normalizeAgentWebToolSource(
        {
          webToolSource: { kind: "mcp", serverId: "missing-server" },
          enabledInternalTools: ["web_fetch"],
          enabledMcpServerIds: ["research-web"],
        },
        [candidate]
      )
    ).toEqual({ kind: "mcp", serverId: "missing-server" });
    expect(
      normalizeAgentWebToolSource(
        {
          enabledInternalTools: ["read"],
          enabledMcpServerIds: ["research-web", "second-web"],
        },
        [
          candidate,
          server("second-web", { webToolSourceCandidate: true }),
        ]
      )
    ).toEqual({ kind: "off" });
  });

  test("removes legacy bundled Web MCP ids from generic selections", () => {
    expect(
      normalizeEnabledMcpServerIds([
        "server-a",
        "builtin-web-search",
        "builtin-web-fetch",
        "server-b",
      ])
    ).toEqual(["server-a", "server-b"]);
  });
});

describe("resolveAgent exclusive Web source assembly", () => {
  test("builtin source injects exactly the internal Web pair and excludes candidates from generic MCP", async () => {
    const result = await resolveAgent(
      definition({
        enabledInternalTools: ["read", "web_search", "web_fetch"],
        enabledMcpServerIds: ["ordinary", "web-candidate", "builtin-web-search"],
        webToolSource: { kind: "builtin" },
      }),
      {
        skills: [],
        mcpServers: [
          server("ordinary"),
          server("web-candidate", { webToolSourceCandidate: true }),
          server("builtin-web-search", { builtin: "web-search" }),
        ],
      }
    );

    expect(resolvedToolNames(result)).toEqual([
      "read",
      "web_search",
      "web_fetch",
      "mcp__ordinary",
    ]);
    expect(buildMcpToolsMock).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "ordinary" })],
      { screenshotDir: undefined }
    );
  });

  test("MCP source removes internal Web tools and injects its selected candidate once", async () => {
    const result = await resolveAgent(
      definition({
        enabledInternalTools: ["read", "web_search", "web_fetch"],
        enabledMcpServerIds: ["ordinary", "web-candidate", "web-candidate"],
        webToolSource: { kind: "mcp", serverId: "web-candidate" },
      }),
      {
        skills: [],
        mcpServers: [
          server("ordinary"),
          server("web-candidate", { webToolSourceCandidate: true }),
        ],
      }
    );

    expect(resolvedToolNames(result)).toEqual([
      "read",
      "mcp__ordinary",
      "mcp__web-candidate",
    ]);
    expect(buildMcpToolsMock.mock.calls[0]?.[0].map((item: McpServer) => item.id)).toEqual([
      "ordinary",
      "web-candidate",
    ]);
  });

  test("off source removes every Web surface while retaining ordinary MCP tools", async () => {
    const result = await resolveAgent(
      definition({
        enabledInternalTools: ["read", "web_search", "web_fetch"],
        enabledMcpServerIds: ["ordinary", "web-candidate", "builtin-web-fetch"],
        webToolSource: { kind: "off" },
      }),
      {
        skills: [],
        mcpServers: [
          server("ordinary"),
          server("web-candidate", { webToolSourceCandidate: true }),
          server("builtin-web-fetch", { builtin: "web-fetch" }),
        ],
      }
    );

    expect(resolvedToolNames(result)).toEqual(["read", "mcp__ordinary"]);
  });

  test("reports an unavailable selected MCP source without falling back to built-in Web", async () => {
    const result = await resolveAgent(
      definition({
        enabledInternalTools: ["read", "web_search", "web_fetch"],
        webToolSource: { kind: "mcp", serverId: "disabled-web" },
      }),
      {
        skills: [],
        mcpServers: [
          server("disabled-web", {
            enabled: false,
            webToolSourceCandidate: true,
          }),
        ],
      }
    );

    expect(resolvedToolNames(result)).toEqual(["read"]);
    expect(result.mcpErrors).toEqual([
      {
        server: "disabled-web",
        error: expect.stringContaining("Web tool source is unavailable"),
      },
    ]);
  });

  test("deduplicates server ids before MCP assembly even when the registry repeats one", async () => {
    const duplicate = server("ordinary");
    await resolveAgent(
      definition({
        enabledMcpServerIds: ["ordinary"],
        webToolSource: { kind: "off" },
      }),
      {
        skills: [],
        mcpServers: [duplicate, { ...duplicate }],
      }
    );

    expect(buildMcpToolsMock.mock.calls[0]?.[0].map((item: McpServer) => item.id)).toEqual([
      "ordinary",
    ]);
  });
});
