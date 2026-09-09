import { describe, expect, test } from "bun:test";

import {
  ResponsesUsageParser,
  classifyResponsesOutcome,
  protocolFor,
  responsesStreamErrorFrames,
} from "../observability.ts";
import { buildSpec } from "../openapi.ts";

// Authentic terminal frames match the captured gpt-6-astra fixtures: Responses
// SSE uses `event: <type>` lines with a `response.usage` object keyed by
// input_tokens/output_tokens/total_tokens.
function completedFrame(usage = {
  input_tokens: 69,
  output_tokens: 20,
  total_tokens: 89,
}): string {
  return (
    "event: response.completed\n" +
    `data: ${JSON.stringify({
      type: "response.completed",
      response: { status: "completed", usage },
    })}\n\n`
  );
}

describe("protocolFor", () => {
  test("classifies the Responses endpoint distinctly", () => {
    expect(protocolFor("/v1/responses")).toBe("openai-responses");
    expect(protocolFor("/v1/chat/completions")).toBe("openai-chat");
  });
});

describe("ResponsesUsageParser", () => {
  test("maps response.usage tokens from a terminal completed event", () => {
    const p = new ResponsesUsageParser();
    p.feed(completedFrame());
    expect(p.tokens()).toEqual({ prompt: 69, completion: 20, total: 89 });
  });

  test("parses across arbitrary chunk boundaries", () => {
    const p = new ResponsesUsageParser();
    const frame = completedFrame();
    for (let i = 0; i < frame.length; i += 7) {
      p.feed(frame.slice(i, i + 7));
    }
    expect(p.tokens()).toEqual({ prompt: 69, completion: 20, total: 89 });
  });

  test("does not double count when usage repeats", () => {
    const p = new ResponsesUsageParser();
    p.feed(completedFrame({ input_tokens: 10, output_tokens: 5, total_tokens: 15 }));
    p.feed(completedFrame({ input_tokens: 10, output_tokens: 5, total_tokens: 15 }));
    expect(p.tokens()).toEqual({ prompt: 10, completion: 5, total: 15 });
  });
});

describe("classifyResponsesOutcome", () => {
  test("completed => success", () => {
    const o = classifyResponsesOutcome(completedFrame());
    expect(o.outcome).toBe("success");
  });

  test("incomplete => non-success with reason preserved", () => {
    const body =
      "event: response.incomplete\n" +
      `data: ${JSON.stringify({
        type: "response.incomplete",
        response: {
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          usage: { input_tokens: 5, output_tokens: 99, total_tokens: 104 },
        },
      })}\n\n`;
    const o = classifyResponsesOutcome(body);
    expect(o.outcome).toBe("incomplete");
    expect(o.diagnostic).toContain("max_output_tokens");
  });

  test("response.failed => upstream failure with diagnostic", () => {
    const body =
      "event: response.failed\n" +
      `data: ${JSON.stringify({
        type: "response.failed",
        response: { status: "failed", error: { code: "server_error", message: "boom" } },
      })}\n\n`;
    const o = classifyResponsesOutcome(body);
    expect(o.outcome).toBe("failed");
    expect(o.diagnostic).toContain("boom");
  });

  test("semantic error event => failure", () => {
    const body =
      "event: error\n" +
      `data: ${JSON.stringify({ type: "error", code: "bad", message: "nope" })}\n\n`;
    const o = classifyResponsesOutcome(body);
    expect(o.outcome).toBe("failed");
    expect(o.diagnostic).toContain("nope");
  });

  test("EOF without a terminal event => truncation failure", () => {
    const body =
      "event: response.created\n" +
      'data: {"type":"response.created","response":{"status":"in_progress"}}\n\n';
    const o = classifyResponsesOutcome(body);
    expect(o.outcome).toBe("truncated");
    expect(o.diagnostic).toContain("terminal");
  });
});

describe("responsesStreamErrorFrames", () => {
  test("emits a Responses-compatible SSE error event", () => {
    const frames = responsesStreamErrorFrames("upstream broke");
    const joined = frames.join("");
    expect(joined).toContain("event: error");
    expect(joined).toContain("upstream broke");
  });
});

describe("OpenAPI", () => {
  test("documents the /v1/responses endpoint and semantics", () => {
    const spec = buildSpec(["Model-Hub/gpt-6-astra"]) as {
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };
    expect(spec.paths["/v1/responses"]).toBeDefined();
    expect(spec.components.schemas.ResponsesRequest).toBeDefined();
  });
});
