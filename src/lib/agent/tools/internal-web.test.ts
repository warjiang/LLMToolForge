import { beforeEach, describe, expect, it, vi } from "vitest";

const transports = vi.hoisted(() => ({
  httpFetch: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@/lib/http", () => ({
  httpFetch: transports.httpFetch,
}));

vi.mock("./shared", async () => {
  const actual = await vi.importActual<typeof import("./shared")>("./shared");
  return { ...actual, invoke: transports.invoke };
});

import {
  FETCH_BODY_HARD_LIMIT,
  FETCH_DETAILS_HARD_LIMIT,
  FETCH_TEXT_HARD_LIMIT,
  SEARCH_DETAILS_HARD_LIMIT,
  SEARCH_TEXT_HARD_LIMIT,
} from "./webProviderCatalog";
import {
  INTERNAL_TOOL_IDS,
  buildInternalTools,
  type InternalToolId,
} from "./internal";
import { useBuiltinWebStore } from "@/store/builtinWeb";
import {
  AGENT_INTERNAL_TOOL_IDS,
  type AgentInternalToolId,
} from "@/types";

const deps = {
  sandboxMode: "workspace-write" as const,
  workspaceRoot: "",
};

function buildWebTools() {
  return buildInternalTools(
    ["web_search", "web_fetch"] as unknown as InternalToolId[],
    deps
  );
}

function toolByName(name: string) {
  const tool = buildWebTools().find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Expected ${name} to be registered`);
  return tool;
}

function resultText(result: Awaited<ReturnType<ReturnType<typeof toolByName>["execute"]>>) {
  const content = result.content[0];
  if (!content || content.type !== "text") {
    throw new Error("Expected a text tool result");
  }
  return content.text;
}

beforeEach(() => {
  transports.httpFetch.mockReset();
  transports.invoke.mockReset();
  useBuiltinWebStore.setState({
    config: {
      providerOrder: ["deepseek", "tavily", "local"],
      credentials: {},
    },
  });
});

describe("internal built-in Web tools", () => {
  it("registers stable search and fetch schemas with provider-neutral bounded descriptions", () => {
    expect(AGENT_INTERNAL_TOOL_IDS).toContain(
      "web_search" as AgentInternalToolId
    );
    expect(INTERNAL_TOOL_IDS).toContain("web_search" as InternalToolId);

    const search = toolByName("web_search");
    const fetch = toolByName("web_fetch");
    const searchSchema = search.parameters as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    const fetchSchema = fetch.parameters as {
      properties: Record<string, unknown>;
      required?: string[];
    };

    expect(buildWebTools().map((tool) => tool.name)).toEqual([
      "web_search",
      "web_fetch",
    ]);
    expect(Object.keys(searchSchema.properties)).toEqual(["goal", "query", "limit"]);
    expect(searchSchema.required).toEqual(["query"]);
    expect(Object.keys(fetchSchema.properties)).toEqual([
      "goal",
      "url",
      "render",
      "maxChars",
      "timeoutMs",
    ]);
    expect(fetchSchema.required).toEqual(["url"]);
    expect(search.description).toMatch(/configured built-in providers/i);
    expect(search.description).toMatch(/20,000 characters/i);
    expect(fetch.description).toMatch(/configured built-in providers/i);
    expect(fetch.description).toMatch(/render=true.*local/i);
    expect(fetch.description).toMatch(/48,000 characters/i);
    expect(fetch.description).not.toMatch(/headless HTTP by default|无需 API Key/i);
  });

  it("keeps rendered fetches local-only and passes caller cancellation to the provider runner", async () => {
    useBuiltinWebStore.setState({
      config: {
        providerOrder: ["deepseek", "tavily", "local"],
        credentials: {
          DEEPSEEK_API_KEY: "deepseek-secret",
          TAVILY_API_KEY: "tavily-secret",
        },
      },
    });
    transports.invoke.mockResolvedValue({
      url: "https://example.test",
      finalUrl: "https://example.test/rendered",
      status: 200,
      title: "Rendered page",
      text: "rendered body",
      links: [],
      truncated: false,
      mode: "render",
    });

    const fetch = toolByName("web_fetch");
    await fetch.execute(
      "rendered-fetch",
      {
        url: "https://example.test",
        render: true,
      },
      new AbortController().signal
    );

    expect(transports.httpFetch).not.toHaveBeenCalled();
    expect(transports.invoke).toHaveBeenCalledWith("web_fetch", {
      req: {
        url: "https://example.test",
        render: true,
        maxChars: FETCH_BODY_HARD_LIMIT,
        timeoutMs: 20_000,
      },
    });

    const aborted = new AbortController();
    aborted.abort();
    await expect(
      fetch.execute(
        "aborted-fetch",
        { url: "https://example.test" },
        aborted.signal
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(transports.invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps the local empty search result format", async () => {
    transports.invoke.mockResolvedValue({
      query: "no local result",
      results: [],
    });

    const result = await toolByName("web_search").execute(
      "empty-search",
      { query: "no local result" },
      new AbortController().signal
    );

    expect(resultText(result)).toBe("未找到与「no local result」相关的结果。");
    expect(result.details).toEqual({
      query: "no local result",
      results: [],
    });
  });

  it("bounds model text and structured details from local results", async () => {
    transports.invoke.mockImplementation(async (command: string) => {
      if (command === "web_search") {
        return {
          query: "q".repeat(2_000),
          results: Array.from({ length: 100 }, () => ({
            title: "t".repeat(2_000),
            url: `https://example.test/${"u".repeat(2_000)}`,
            snippet: "s".repeat(2_000),
          })),
        };
      }
      return {
        url: "https://example.test",
        finalUrl: "https://example.test/final",
        status: 200,
        title: "Fetch result",
        text: "x".repeat(FETCH_BODY_HARD_LIMIT + 10_000),
        links: Array.from({ length: 100 }, () => ({
          text: "link".repeat(500),
          href: `https://example.test/${"path".repeat(500)}`,
        })),
        truncated: false,
        mode: "http",
      };
    });

    const signal = new AbortController().signal;
    const searchResult = await toolByName("web_search").execute(
      "bounded-search",
      { query: "bounded" },
      signal
    );
    const fetchResult = await toolByName("web_fetch").execute(
      "bounded-fetch",
      { url: "https://example.test", maxChars: 99_999 },
      signal
    );

    expect(Array.from(resultText(searchResult)).length).toBeLessThanOrEqual(
      SEARCH_TEXT_HARD_LIMIT
    );
    expect(JSON.stringify(searchResult.details).length).toBeLessThanOrEqual(
      SEARCH_DETAILS_HARD_LIMIT
    );
    expect(Array.from(resultText(fetchResult)).length).toBeLessThanOrEqual(
      FETCH_TEXT_HARD_LIMIT
    );
    expect(JSON.stringify(fetchResult.details).length).toBeLessThanOrEqual(
      FETCH_DETAILS_HARD_LIMIT
    );
    expect(
      Array.from(
        (fetchResult.details as { text: string }).text
      ).length
    ).toBeLessThanOrEqual(FETCH_BODY_HARD_LIMIT);
  });
});
