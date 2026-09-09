import { afterEach, describe, expect, test } from "vitest";
import type { Context } from "@earendil-works/pi-ai";
import { buildPiModel } from "../model";
import { applyResponsesReplayPolicy, createUnifiedRuntime } from "../provider";
import type { ExposedModel } from "@/lib/unifiedApi";
import {
  installMockFetch,
  loadFixture,
  type MockFetchResult,
} from "./responsesTestHarness";

const BASE_URL = "http://127.0.0.1:4141/v1";
const LOCAL_KEY = "sk-local-test";

function exposed(realModel: string): ExposedModel {
  return {
    id: `Model-Hub/${realModel}`,
    realModel,
    provider: "manual",
    baseUrl: "https://upstream.example/v1",
    apiKey: "upstream-key",
    connId: "key:conn1",
    connName: "Model-Hub",
    features: ["function-call"],
  };
}

const ECHO_TOOL = {
  name: "echo",
  label: "Echo",
  description: "Echo back the provided text verbatim.",
  parameters: {
    type: "object",
    required: ["text"],
    properties: { text: { type: "string", description: "text to echo" } },
  },
  execute: async () => ({
    content: [{ type: "text" as const, text: "ECHO" }],
    details: {},
  }),
} as never;

function context(): Context {
  return {
    systemPrompt: "Call echo once then answer.",
    messages: [
      { role: "user", content: 'Echo "spike-42" then report it.' } as never,
    ],
    tools: [ECHO_TOOL],
  };
}

async function drain(
  stream: AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>
): Promise<void> {
  const resolved = await stream;
  for await (const _ of resolved) {
    // consume
  }
}

let mock: MockFetchResult | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

describe("applyResponsesReplayPolicy", () => {
  test("keeps store:false, drops previous_response_id, merges include", () => {
    const out = applyResponsesReplayPolicy({
      store: true,
      previous_response_id: "resp_x",
      include: ["file_search_call.results"],
    }) as Record<string, unknown>;
    expect(out.store).toBe(false);
    expect(out).not.toHaveProperty("previous_response_id");
    expect(out.include).toEqual([
      "file_search_call.results",
      "reasoning.encrypted_content",
    ]);
  });

  test("adds include when none exists and does not inject reasoning effort", () => {
    const out = applyResponsesReplayPolicy({}) as Record<string, unknown>;
    expect(out.include).toEqual(["reasoning.encrypted_content"]);
    expect(out).not.toHaveProperty("reasoning");
  });

  test("does not duplicate an existing encrypted-content include", () => {
    const out = applyResponsesReplayPolicy({
      include: ["reasoning.encrypted_content"],
    }) as Record<string, unknown>;
    expect(out.include).toEqual(["reasoning.encrypted_content"]);
  });
});

describe("Responses provider serialization (real SDK)", () => {
  test("gpt-6-astra tool run posts /responses with the correct wire payload", async () => {
    mock = installMockFetch([{ body: loadFixture("initial-toolcall.sse") }]);
    const model = buildPiModel(exposed("gpt-6-astra"), {
      baseUrl: BASE_URL,
      transport: "openai-responses",
    });
    const { streamFn } = createUnifiedRuntime(
      [model],
      BASE_URL,
      LOCAL_KEY,
      "openai-responses"
    );
    await drain(streamFn(model, context()));

    expect(mock.requests).toHaveLength(1);
    const req = mock.requests[0];
    expect(req.url).toContain("/responses");
    const body = req.body as Record<string, unknown>;
    // Exposed wire id retained so the gateway can route/auth normally.
    expect(body.model).toBe("Model-Hub/gpt-6-astra");
    expect(body.store).toBe(false);
    expect(body.include).toContain("reasoning.encrypted_content");
    // No implicit reasoning-off / effort override.
    expect(body).not.toHaveProperty("reasoning");
    // Tool description + schema preserved via Pi's converter.
    const tools = body.tools as Array<Record<string, unknown>>;
    expect(tools[0].name).toBe("echo");
    expect(tools[0].description).toBe("Echo back the provided text verbatim.");
    expect((tools[0].parameters as Record<string, unknown>).properties).toBeDefined();
  });

  test("historical completions model keeps the Chat payload unchanged", async () => {
    // Minimal OpenAI chat SSE: one content delta then [DONE].
    const chatSse =
      'data: {"id":"1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"hi"}}]}\n\n' +
      "data: [DONE]\n\n";
    mock = installMockFetch([{ body: chatSse }]);
    const model = buildPiModel(exposed("gpt-5.6-terra"), {
      baseUrl: BASE_URL,
      transport: "openai-completions",
    });
    const { streamFn } = createUnifiedRuntime(
      [model],
      BASE_URL,
      LOCAL_KEY,
      "openai-completions"
    );
    await drain(streamFn(model, context()));

    expect(mock.requests).toHaveLength(1);
    const req = mock.requests[0];
    expect(req.url).toContain("/chat/completions");
    const body = req.body as Record<string, unknown>;
    expect(body.model).toBe("Model-Hub/gpt-5.6-terra");
    // Chat path must not carry Responses-only fields.
    expect(body).not.toHaveProperty("include");
    expect(body).toHaveProperty("messages");
  });
});
