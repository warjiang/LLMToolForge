import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentDefinition } from "@/types";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ExposedModel } from "@/lib/unifiedApi";
import {
  installMockFetch,
  loadFixture,
  type MockFetchResult,
} from "./responsesTestHarness";

// ---- module mocks: real Pi Agent loop, mocked stores + tool discovery -------

const resolveAgentMock = vi.fn();
const unifiedState = {
  supported: true,
  status: { running: true },
  models: [] as ExposedModel[],
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
vi.mock("../gatewayFetch", () => ({
  ensureGatewayFetch: async () => {},
}));

import { createAgentRuntime, type AgentRuntimeCallbacks } from "../runtime";

const BASE_TOOL_TEXT = "ECHO:spike-42";

function echoTool(counter: { calls: number }): AgentTool {
  return {
    name: "echo",
    label: "Echo",
    description: "Echo back the provided text verbatim.",
    parameters: {
      type: "object",
      required: ["text"],
      properties: { text: { type: "string", description: "text" } },
    },
    execute: async () => {
      counter.calls += 1;
      return {
        content: [{ type: "text" as const, text: BASE_TOOL_TEXT }],
        details: {},
      };
    },
  } as unknown as AgentTool;
}

function setExposed(realModel: string): void {
  unifiedState.models = [
    {
      id: `Model-Hub/${realModel}`,
      realModel,
      provider: "manual",
      baseUrl: "https://upstream.example/v1",
      apiKey: "upstream-key",
      connId: "key:conn1",
      connName: "Model-Hub",
      features: ["function-call"],
    },
  ];
}

function def(realModel: string): AgentDefinition {
  return {
    modelId: `Model-Hub/${realModel}`,
  } as unknown as AgentDefinition;
}

function recordingCallbacks() {
  const events: string[] = [];
  const cbs: AgentRuntimeCallbacks = {
    onAssistantStart: () => {
      events.push("assistant_start");
    },
    onAssistantEnd: (text) => {
      events.push(`assistant_end:${text.slice(0, 40)}`);
    },
    onReasoningDelta: () => {
      events.push("reasoning");
    },
    onToolStart: (i) => {
      events.push(`tool_start:${i.toolName}`);
    },
    onToolEnd: (i) => {
      events.push(`tool_end:${i.toolName}:${i.isError}`);
    },
    onError: (m) => {
      events.push(`error:${m}`);
    },
    onDone: () => {
      events.push("done");
    },
  };
  return { events, cbs };
}

let mock: MockFetchResult | undefined;

beforeEach(() => {
  resolveAgentMock.mockReset();
  unifiedState.start.mockClear();
});
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

describe("createAgentRuntime transport selection + tool loop", () => {
  test("gpt-6-astra with tools runs the full Responses tool loop once", async () => {
    const counter = { calls: 0 };
    resolveAgentMock.mockResolvedValue({
      systemPrompt: "Call echo once then answer.",
      tools: [echoTool(counter)],
      mcpErrors: [],
      mcpPending: [],
    });
    setExposed("gpt-6-astra");
    mock = installMockFetch([
      { body: loadFixture("initial-toolcall.sse") },
      { body: loadFixture("continuation-final.sse") },
    ]);

    const { events, cbs } = recordingCallbacks();
    const runtime = await createAgentRuntime(def("gpt-6-astra"), cbs);
    await runtime.prompt('Echo "spike-42" then report it.');
    await runtime.waitForIdle();

    // Two upstream requests, both to /responses, tool executed exactly once.
    expect(mock.requests).toHaveLength(2);
    expect(mock.requests[0].url).toContain("/responses");
    expect(mock.requests[1].url).toContain("/responses");
    expect(counter.calls).toBe(1);
    // Continuation replays the function call + output statelessly.
    const cont = mock.requests[1].body as Record<string, unknown>;
    const input = cont.input as Array<Record<string, unknown>>;
    expect(input.some((i) => i.type === "function_call")).toBe(true);
    expect(input.some((i) => i.type === "function_call_output")).toBe(true);
    expect(cont.store).toBe(false);
    // Callback sequence covers tool start/end and a successful final answer.
    expect(events).toContain("tool_start:echo");
    expect(events).toContain("tool_end:echo:false");
    expect(events.some((e) => e.startsWith("assistant_end:"))).toBe(true);
    expect(events).toContain("done");
    expect(events.some((e) => e.startsWith("error:"))).toBe(false);
  });

  test("gpt-6-astra without tools uses Chat Completions", async () => {
    resolveAgentMock.mockResolvedValue({
      systemPrompt: "no tools",
      tools: [],
      mcpErrors: [],
      mcpPending: [],
    });
    setExposed("gpt-6-astra");
    const chatSse =
      'data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"hi"}}]}\n\n' +
      'data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
      "data: [DONE]\n\n";
    mock = installMockFetch([{ body: chatSse }]);

    const { cbs } = recordingCallbacks();
    const runtime = await createAgentRuntime(def("gpt-6-astra"), cbs);
    await runtime.prompt("hello");
    await runtime.waitForIdle();

    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].url).toContain("/chat/completions");
  });

  test("historical model with tools stays on Chat Completions", async () => {
    const counter = { calls: 0 };
    resolveAgentMock.mockResolvedValue({
      systemPrompt: "tools",
      tools: [echoTool(counter)],
      mcpErrors: [],
      mcpPending: [],
    });
    setExposed("gpt-5.6-terra");
    const chatSse =
      'data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"hi"}}]}\n\n' +
      'data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
      "data: [DONE]\n\n";
    mock = installMockFetch([{ body: chatSse }]);

    const { cbs } = recordingCallbacks();
    const runtime = await createAgentRuntime(def("gpt-5.6-terra"), cbs);
    await runtime.prompt("hello");
    await runtime.waitForIdle();

    expect(mock.requests[0].url).toContain("/chat/completions");
  });
});

describe("Responses failure lifecycle: no auto-retry, no partial execution", () => {
  test("compatibility 400 for an unknown model surfaces once, no second request", async () => {
    const counter = { calls: 0 };
    resolveAgentMock.mockResolvedValue({
      systemPrompt: "tools",
      tools: [echoTool(counter)],
      mcpErrors: [],
      mcpPending: [],
    });
    // Unknown model still routes Chat Completions; simulate the upstream 400.
    setExposed("some-unknown-model");
    const errBody = JSON.stringify({
      error: {
        message:
          "Function tools with reasoning_effort are not supported for this model in /v1/chat/completions.",
        type: "invalid_request_error",
      },
    });
    mock = installMockFetch([{ body: errBody, status: 400 }]);

    const { events, cbs } = recordingCallbacks();
    const runtime = await createAgentRuntime(def("some-unknown-model"), cbs);
    await runtime.prompt("hello");
    await runtime.waitForIdle();

    // Exactly one attempt: no automatic protocol switch / retry.
    expect(mock.requests).toHaveLength(1);
    expect(counter.calls).toBe(0);
    expect(events.some((e) => e.startsWith("error:"))).toBe(true);
    expect(events.some((e) => e.startsWith("assistant_end:"))).toBe(false);
  });

  test("Responses HTTP rejection surfaces as error without executing tools", async () => {
    const counter = { calls: 0 };
    resolveAgentMock.mockResolvedValue({
      systemPrompt: "tools",
      tools: [echoTool(counter)],
      mcpErrors: [],
      mcpPending: [],
    });
    setExposed("gpt-6-astra");
    mock = installMockFetch([
      {
        body: JSON.stringify({ error: { message: "bad gateway" } }),
        status: 502,
      },
    ]);

    const { events, cbs } = recordingCallbacks();
    const runtime = await createAgentRuntime(def("gpt-6-astra"), cbs);
    await runtime.prompt("hello");
    await runtime.waitForIdle();

    expect(mock.requests).toHaveLength(1);
    expect(counter.calls).toBe(0);
    expect(events.some((e) => e.startsWith("error:"))).toBe(true);
  });

  test("premature EOF after a completed tool does not re-execute it", async () => {
    const counter = { calls: 0 };
    resolveAgentMock.mockResolvedValue({
      systemPrompt: "tools",
      tools: [echoTool(counter)],
      mcpErrors: [],
      mcpPending: [],
    });
    setExposed("gpt-6-astra");
    // First stream: full tool call. Second: truncated (no terminal event).
    const truncated = loadFixture("continuation-final.sse").slice(0, 200);
    mock = installMockFetch([
      { body: loadFixture("initial-toolcall.sse") },
      { body: truncated },
    ]);

    const { events, cbs } = recordingCallbacks();
    const runtime = await createAgentRuntime(def("gpt-6-astra"), cbs);
    await runtime.prompt('Echo "spike-42" then report it.');
    await runtime.waitForIdle();

    // Tool ran once on the first turn; the failed continuation must not re-run it.
    expect(counter.calls).toBe(1);
    // No third request was issued automatically.
    expect(mock.requests.length).toBeLessThanOrEqual(2);
    expect(events).toContain("tool_end:echo:false");
  });
});

describe("later turns and persisted-history seeding", () => {
  test("seeded history reuses Responses and does not carry provider item ids", async () => {
    resolveAgentMock.mockResolvedValue({
      systemPrompt: "Call echo once then answer.",
      tools: [echoTool({ calls: 0 })],
      mcpErrors: [],
      mcpPending: [],
    });
    setExposed("gpt-6-astra");
    // Seed prior text-only history; the next turn is a plain completion.
    const plain =
      "event: response.created\n" +
      'data: {"type":"response.created","response":{"id":"resp_x","status":"in_progress"}}\n\n' +
      "event: response.output_item.added\n" +
      'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg_1","role":"assistant","content":[]}}\n\n' +
      "event: response.content_part.added\n" +
      'data: {"type":"response.content_part.added","item_id":"msg_1","output_index":0,"content_index":0,"part":{"type":"output_text","text":""}}\n\n' +
      "event: response.output_text.delta\n" +
      'data: {"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"content_index":0,"delta":"hi again"}\n\n' +
      "event: response.output_item.done\n" +
      'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg_1","role":"assistant","content":[{"type":"output_text","text":"hi again"}]}}\n\n' +
      "event: response.completed\n" +
      'data: {"type":"response.completed","response":{"id":"resp_x","status":"completed","output":[],"usage":{"input_tokens":5,"output_tokens":2,"total_tokens":7}}}\n\n';
    mock = installMockFetch([{ body: plain }]);

    const { events, cbs } = recordingCallbacks();
    const runtime = await createAgentRuntime(def("gpt-6-astra"), cbs, {
      seedHistory: [
        { role: "user", content: "earlier question" },
        {
          role: "assistant",
          content: "earlier answer",
          status: "complete",
          modelId: "Model-Hub/gpt-6-astra",
        },
      ],
    });
    await runtime.prompt("follow-up");
    await runtime.waitForIdle();

    expect(mock.requests[0].url).toContain("/responses");
    const body = mock.requests[0].body as Record<string, unknown>;
    const input = body.input as Array<Record<string, unknown>>;
    // Seeded assistant text is replayed as plain content, never as a provider
    // function_call/reasoning item with a dangling id.
    expect(input.some((i) => i.type === "function_call")).toBe(false);
    expect(input.some((i) => i.type === "reasoning")).toBe(false);
    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain("fc_");
    expect(serialized).not.toContain("rs_");
    expect(events.some((e) => e.startsWith("assistant_end:"))).toBe(true);
  });
});

