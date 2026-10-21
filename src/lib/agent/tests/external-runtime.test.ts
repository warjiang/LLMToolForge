import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentDefinition } from "@/types";

const resolveAgentMock = vi.fn();
const invokeMock = vi.fn(async () => undefined);
const listenMock = vi.fn(async () => () => {});
const unifiedState = {
  supported: true,
  status: { running: true },
  models: [{
    id: "Test/model",
    realModel: "model",
    provider: "manual",
    baseUrl: "https://upstream.example/v1",
    apiKey: "upstream-key",
    connId: "key:test",
    connName: "Test",
    features: [],
  }],
  config: { port: 4141, localKey: "sk-local-test" },
  start: vi.fn(async () => {}),
};

vi.mock("@/store/unified", () => ({
  useUnifiedStore: { getState: () => unifiedState },
}));
vi.mock("@/store", () => ({
  useSkillStore: { getState: () => ({ items: [] }) },
  getEffectiveMcpServers: () => [],
}));
vi.mock("../agentDefinition", () => ({
  resolveAgent: (...args: unknown[]) => resolveAgentMock(...args),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

import { createExternalAgentRuntime } from "../externalRuntime";

function externalDefinition(): AgentDefinition {
  return {
    id: "external-agent",
    kind: "external",
    modelId: "Test/model",
    external: {
      runtime: "node",
      framework: "test",
      packageDir: "/tmp/external-agent",
      packageId: "external-agent",
      entry: "index.js",
    },
  } as AgentDefinition;
}

describe("createExternalAgentRuntime", () => {
  beforeEach(() => {
    resolveAgentMock.mockReset();
    invokeMock.mockClear();
    listenMock.mockClear();
  });

  test("preserves resolved MCP configuration errors and pending servers", async () => {
    const mcpErrors = [{
      server: "Selected Web MCP",
      error: "Configured Web MCP source is unavailable",
    }];
    const mcpPending = ["Selected Web MCP"];
    resolveAgentMock.mockResolvedValue({
      systemPrompt: "",
      tools: [],
      mcpErrors,
      mcpPending,
    });

    const runtime = await createExternalAgentRuntime(externalDefinition(), {});

    expect(runtime.mcpErrors).toEqual(mcpErrors);
    expect(runtime.mcpPending).toEqual(mcpPending);
  });
});
