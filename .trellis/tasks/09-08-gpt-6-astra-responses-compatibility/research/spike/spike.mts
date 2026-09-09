/**
 * Phase 0 spike harness — GPT-6 Astra Responses tool-loop validation.
 *
 * This is a THROWAWAY validation script, not production code. It reproduces the
 * exact runtime path the design proposes (design.md "Gate: Verify the Complete
 * Pi Tool Loop") so we can prove — against a REAL `gpt-6-astra` upstream through
 * the running desktop Unified gateway — that:
 *
 *   1. Pi's Responses API can stream a tool-enabled turn without the reported
 *      Chat-Completions `reasoning_effort` 400.
 *   2. Pi executes a side-effect-free echo tool exactly once.
 *   3. Pi replays the function call + result + reasoning items on the next
 *      request (stateless, store:false) and reaches `response.completed` with a
 *      final answer that uses the tool result.
 *
 * It also runs a Chat-Completions control with the same tool for comparison.
 *
 * The harness does NOT touch production entry points. It talks to the gateway
 * over plain Node `fetch` (loopback HTTP), exactly like the app's plugin-http
 * shim does from the WebView.
 *
 * ── How to run ────────────────────────────────────────────────────────────
 *   See research/spike/README.md. In short:
 *
 *     GATEWAY_PORT=4141 \
 *     GATEWAY_LOCAL_KEY='<your local key or empty>' \
 *     EXPOSED_MODEL='<connName>/gpt-6-astra' \
 *     node .trellis/tasks/09-08-gpt-6-astra-responses-compatibility/research/spike/spike.mts
 *
 *   Node 24+ runs this .mts file directly (type stripping); no build step.
 *
 * ── Output ────────────────────────────────────────────────────────────────
 *   Writes sanitized artifacts next to this file under ./out/:
 *     - responses-request-1.json / responses-request-2.json  (serialized payloads)
 *     - responses-events.jsonl                                (SSE event types seen)
 *     - completions-*                                          (control run)
 *     - summary.json                                           (PASS/FAIL + counts)
 *   Encrypted reasoning payloads are replaced with a synthetic marker before
 *   writing; no credentials are ever written.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createModels,
  createProvider,
  Type,
  type ApiKeyAuth,
  type AuthResult,
  type Model,
} from "@earendil-works/pi-ai";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
} from "@earendil-works/pi-agent-core";

// ── Config from env ─────────────────────────────────────────────────────────

const PORT = Number(process.env.GATEWAY_PORT ?? "4141");
const LOCAL_KEY = process.env.GATEWAY_LOCAL_KEY ?? "";
const EXPOSED_MODEL = process.env.EXPOSED_MODEL ?? "";
const BASE_URL = `http://127.0.0.1:${PORT}/v1`;
const FALLBACK_LOCAL_KEY = "sk-unified-local";

if (!EXPOSED_MODEL) {
  console.error(
    "EXPOSED_MODEL is required, e.g. EXPOSED_MODEL='my-conn/gpt-6-astra'.\n" +
      "Find it via the app (Unified page) or GET " +
      `${BASE_URL}/models`,
  );
  process.exit(2);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");

const PROVIDER_ID = "unified";
const UNIFIED_KEY = LOCAL_KEY.trim() || FALLBACK_LOCAL_KEY;

// ── Instrumentation captured across the run ──────────────────────────────────

interface Capture {
  /** Serialized upstream request payloads (as Pi built them), sanitized. */
  requests: unknown[];
  /** SSE / stream event types observed, in order. */
  eventTypes: string[];
  /** Terminal response status (response.completed / failed / incomplete). */
  terminalStatus: string | null;
  /** Whether an implicit reasoning.effort override was seen in any request. */
  sawEffortOverride: boolean;
  /** Whether include: reasoning.encrypted_content was present. */
  sawEncryptedInclude: boolean;
}

function newCapture(): Capture {
  return {
    requests: [],
    eventTypes: [],
    terminalStatus: null,
    sawEffortOverride: false,
    sawEncryptedInclude: false,
  };
}

/** Replace opaque encrypted reasoning payloads with a synthetic marker. */
function sanitize(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, val) => {
      if (key === "encrypted_content" && typeof val === "string") {
        return `<<SYNTHETIC_ENCRYPTED_REASONING len=${val.length}>>`;
      }
      // Never persist auth-shaped values.
      if (
        (key === "apiKey" || key === "api_key" || key === "authorization") &&
        typeof val === "string"
      ) {
        return "<<REDACTED>>";
      }
      return val;
    }),
  );
}

// ── Auth (matches production unifiedApiKeyAuth) ───────────────────────────────

function unifiedAuth(): ApiKeyAuth {
  return {
    name: "Unified Gateway",
    resolve: async ({ model }): Promise<AuthResult> => ({
      auth: { apiKey: UNIFIED_KEY, baseUrl: model.baseUrl },
      source: "unified-gateway",
    }),
  };
}

// ── Models ────────────────────────────────────────────────────────────────

function responsesModel(): Model<"openai-responses"> {
  return {
    id: EXPOSED_MODEL,
    name: EXPOSED_MODEL,
    api: "openai-responses",
    provider: PROVIDER_ID,
    baseUrl: BASE_URL,
    // Same declaration as production buildPiModel; see design.md "Responses
    // Payload and Reasoning State". Reasoning replay is requested via onPayload,
    // NOT by flipping this to true (which would inject reasoning.effort:"none").
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  } as Model<"openai-responses">;
}

function completionsModel(): Model<"openai-completions"> {
  return {
    id: EXPOSED_MODEL,
    name: EXPOSED_MODEL,
    api: "openai-completions",
    provider: PROVIDER_ID,
    baseUrl: BASE_URL,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  } as Model<"openai-completions">;
}

// ── The echo tool: side-effect-free, executed at most once per prompt ─────────

function buildEchoTool(counter: { calls: number }): AgentTool {
  const def = {
    name: "echo",
    label: "Echo",
    description:
      "Echo back the provided text verbatim. Use this exactly once to obtain " +
      "the canonical echo of the user's phrase, then answer using its result.",
    parameters: Type.Object({
      text: Type.String({ description: "The exact text to echo back." }),
    }),
    execute: async (_id: string, params: { text: string }) => {
      counter.calls += 1;
      return {
        content: [{ type: "text" as const, text: `ECHO:${params.text}` }],
        details: { echoed: params.text, callIndex: counter.calls },
      };
    },
  };
  return def as unknown as AgentTool;
}

// ── onPayload policy (the exact production proposal) ─────────────────────────

/**
 * Merge reasoning.encrypted_content into `include` and keep store:false, without
 * injecting any effort override. Records what it observed for the summary.
 */
function makeResponsesOnPayload(cap: Capture) {
  return (payload: unknown): unknown => {
    const p = payload as Record<string, unknown>;

    // Preserve stateless replay.
    p.store = false;
    delete (p as { previous_response_id?: unknown }).previous_response_id;

    // Merge, don't replace.
    const include = new Set<string>(
      Array.isArray(p.include) ? (p.include as string[]) : [],
    );
    include.add("reasoning.encrypted_content");
    p.include = [...include];

    // Observe: did anything inject an effort override we did not ask for?
    const reasoning = p.reasoning as { effort?: unknown } | undefined;
    if (reasoning && "effort" in reasoning) cap.sawEffortOverride = true;
    if ((p.include as string[]).includes("reasoning.encrypted_content")) {
      cap.sawEncryptedInclude = true;
    }

    cap.requests.push(sanitize(p));
    return p;
  };
}

// ── Runtime wiring ──────────────────────────────────────────────────────────

function makeStreamFn(
  api: "openai-responses" | "openai-completions",
  cap: Capture,
): StreamFn {
  const collection = createModels();
  collection.setProvider(
    createProvider({
      id: PROVIDER_ID,
      name: "Unified Gateway",
      baseUrl: BASE_URL,
      auth: { apiKey: unifiedAuth() },
      models:
        api === "openai-responses"
          ? [responsesModel()]
          : [completionsModel()],
      api:
        api === "openai-responses"
          ? openAIResponsesApi()
          : openAICompletionsApi(),
    }),
  );

  const onPayload =
    api === "openai-responses"
      ? makeResponsesOnPayload(cap)
      : (payload: unknown) => {
          cap.requests.push(sanitize(payload));
          return payload;
        };

  return (model, context, options) =>
    collection.streamSimple(model, context, {
      ...options,
      onPayload,
      maxRetries: 0,
    });
}

const SYSTEM_PROMPT =
  "You are a test agent. When asked to echo a phrase, call the `echo` tool " +
  "exactly once with the phrase, then reply with a single sentence that " +
  "quotes the tool's echoed result.";

const USER_PROMPT =
  'Echo the phrase "astra-responses-spike-42" using the echo tool, then tell ' +
  "me what the tool returned.";

async function runOnce(
  label: string,
  api: "openai-responses" | "openai-completions",
): Promise<{
  cap: Capture;
  toolCalls: number;
  finalText: string;
  errorMessage: string | null;
}> {
  const cap = newCapture();
  const counter = { calls: 0 };
  const model = api === "openai-responses" ? responsesModel() : completionsModel();
  const streamFn = makeStreamFn(api, cap);

  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model: model as Model<never>,
      tools: [buildEchoTool(counter)],
      messages: [] as AgentMessage[],
    },
    streamFn,
  });

  let finalText = "";
  let errorMessage: string | null = null;

  agent.subscribe(async (event: AgentEvent) => {
    cap.eventTypes.push(event.type);
    if (event.type === "message_end") {
      const msg = (event as { message?: AgentMessage }).message;
      if (msg?.role === "assistant") {
        const m = msg as Extract<AgentMessage, { role: "assistant" }>;
        if (m.errorMessage) errorMessage = m.errorMessage;
        const text = m.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("");
        if (text) finalText = text;
        if (m.stopReason) cap.terminalStatus = m.stopReason;
      }
    }
  });

  console.log(`\n=== [${label}] streaming (${api}) ===`);
  try {
    await agent.prompt(USER_PROMPT);
    await agent.waitForIdle();
  } catch (err) {
    errorMessage = (err as Error).message;
    console.error(`[${label}] prompt threw:`, errorMessage);
  }

  return { cap, toolCalls: counter.calls, finalText, errorMessage };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  await mkdir(OUT, { recursive: true });

  console.log("Spike config:", {
    baseUrl: BASE_URL,
    exposedModel: EXPOSED_MODEL,
    hasLocalKey: Boolean(LOCAL_KEY.trim()),
  });

  // 1) Responses tool loop (the actual gate).
  const responses = await runOnce("responses", "openai-responses");

  await writeFile(
    join(OUT, "responses-events.jsonl"),
    responses.cap.eventTypes.map((t) => JSON.stringify({ type: t })).join("\n"),
  );
  for (let i = 0; i < responses.cap.requests.length; i++) {
    await writeFile(
      join(OUT, `responses-request-${i + 1}.json`),
      JSON.stringify(responses.cap.requests[i], null, 2),
    );
  }

  // 2) Chat-Completions control with the same tool.
  let control: Awaited<ReturnType<typeof runOnce>> | null = null;
  try {
    control = await runOnce("completions-control", "openai-completions");
    await writeFile(
      join(OUT, "completions-events.jsonl"),
      control.cap.eventTypes.map((t) => JSON.stringify({ type: t })).join("\n"),
    );
    for (let i = 0; i < control.cap.requests.length; i++) {
      await writeFile(
        join(OUT, `completions-request-${i + 1}.json`),
        JSON.stringify(control.cap.requests[i], null, 2),
      );
    }
  } catch (err) {
    console.error("control run failed:", (err as Error).message);
  }

  // 3) Evaluate the gate. PASS requires: no error, exactly one tool call, at
  //    least two upstream requests (initial + continuation replay), a completed
  //    terminal status, a final answer that uses the echoed value, no implicit
  //    effort override, and the encrypted-content include present.
  const usedEcho = responses.finalText.includes("astra-responses-spike-42");
  const pass =
    responses.errorMessage === null &&
    responses.toolCalls === 1 &&
    responses.cap.requests.length >= 2 &&
    responses.cap.terminalStatus === "stop" &&
    usedEcho &&
    !responses.cap.sawEffortOverride &&
    responses.cap.sawEncryptedInclude;

  const summary = {
    pass,
    checkedAt: new Date().toISOString(),
    responses: {
      errorMessage: responses.errorMessage,
      toolCalls: responses.toolCalls,
      upstreamRequestCount: responses.cap.requests.length,
      terminalStatus: responses.cap.terminalStatus,
      finalAnswerUsesEcho: usedEcho,
      sawImplicitEffortOverride: responses.cap.sawEffortOverride,
      sawEncryptedContentInclude: responses.cap.sawEncryptedInclude,
      eventTypeCount: responses.cap.eventTypes.length,
      finalTextPreview: responses.finalText.slice(0, 200),
    },
    completionsControl: control
      ? {
          errorMessage: control.errorMessage,
          toolCalls: control.toolCalls,
          upstreamRequestCount: control.cap.requests.length,
          terminalStatus: control.cap.terminalStatus,
          finalTextPreview: control.finalText.slice(0, 200),
        }
      : "control-run-failed",
  };

  await writeFile(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nArtifacts written to: ${OUT}`);
  console.log(pass ? "\n✅ SPIKE PASS" : "\n❌ SPIKE FAIL — see summary.json");

  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error("harness crashed:", err);
  process.exit(3);
});
