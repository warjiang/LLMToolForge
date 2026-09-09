# GPT-6 Astra Tool Calling Protocol Compatibility Design

## Decision and Scope

Fix the existing Pi tool-execution path. Select Pi's Responses API for the exact
upstream model id `gpt-6-astra` when resolved function tools are present; retain
Chat Completions for every other case. Reuse Pi's serializers, streaming parser,
tool loop, and in-memory message context.

Do not build a second tool loop in the Direct Chat adapter. Do not add automatic
protocol retry, capability learning, a persistence layer, or a user setting.
The gateway already forwards Responses; its changes are limited to
protocol-aware diagnostics, usage, terminal-state observation, and OpenAPI.

## Evidence and Actual Call Boundaries

The reported upstream rejection is:

```text
Function tools with reasoning_effort are not supported for this model in
/v1/chat/completions. To use function tools, use /v1/responses or set
reasoning_effort to 'none'.
```

The earlier local serialization check established that the current
`reasoning: false` Pi declaration does not explicitly send `reasoning_effort`.
It did not establish that Responses works against the affected upstream.

### Pi Is the Tool-Execution Path

```text
Ordinary chat with tools -> ad-hoc AgentDefinition
DataAgent / ResearchAgent -> built-in AgentDefinition
  -> createAgentRuntime()
  -> resolveAgent() -> actual function tools
  -> buildPiModel() -> one selected Pi API
  -> createUnifiedRuntime()
  -> Unified Gateway /v1/chat/completions or /v1/responses
  -> configured upstream with payload.model rewritten to realModel
```

Evidence: `resolveTurnAgent()` and `send()` in
`src/pages/agent/AgentChatView.tsx`, plus `src/lib/agent/runtime.ts`.
The existing runtime builds the model before resolving tools; reorder those
operations so protocol selection uses `resolved.tools.length > 0`.

Use `ExposedModel.realModel` for matching and retain `ExposedModel.id` in the Pi
wire request so the gateway can perform normal connection routing and auth.
Connection identity selects the route; it is not a new capability-cache key.
Select once per runtime and retain that API across all tool continuations.

### Direct Chat Is Not Another Agent Runtime

`generateAssistantForUser()` calls the provider adapter with
`settings.modelId` and the connection's own base URL/API key. The helper named
`gatewayFetch` in `src/lib/providers/openai-compatible/request.ts` wraps
`httpFetch`; it does not force traffic through the embedded Unified Gateway.
There is no exposed-id reverse mapping to add at this call site.

The underlying adapter path has these existing limits:

- `ChatMessage` has no native tool-result or assistant tool-call fields.
- `ChatStreamChunk` has no tool-call field.
- The UI only streams adapter requests when `tools.length === 0`.
- Non-streaming returned tool calls are recorded, not executed and replayed.

Leave that path, its types, and its `wireFormats` unchanged. Its legacy
tool-bearing fallback is not upgraded by this task; the supported tool workflow
requires the existing Pi/Unified Gateway route. A future adapter tool-loop
feature needs its own requirements, not an implicit compatibility patch.

### Other Boundaries

- Preserve the existing Volcengine adapter and its explicit format selection.
  Its text-only Responses parser is not the implementation template here.
- External AAP agents select their own SDK/API. No transparent Chat-to-Responses
  gateway bridge is included.
- OpenAI Chat Completions and Responses are distinct wire protocols:
  <https://platform.openai.com/docs/guides/migrate-to-responses>.

## Gate: Verify the Complete Pi Tool Loop

Before production changes, use the installed Pi 0.80.2 APIs and an available
affected connection through the real gateway. Do not use a hand-written
one-request HTTP example as proof of runtime compatibility.

1. Construct the same exposed-model identity, auth, prompt role, tool schema,
   and Responses payload policy proposed below.
2. Stream a request asking the model to call a side-effect-free echo tool once.
3. Let Pi execute it and serialize the function call, tool result, and reasoning
   items into the next request.
4. Require a final `response.completed` and a final answer that uses the tool
   result. Check both upstream requests and count actual tool executions.
5. Compare with a historical-model Chat-Completions control using the same tool.

Capture sanitized findings in `research/pi-responses-spike.md` and sanitized
stream fixtures for offline tests. Record SDK version, request fields, event
types, terminal status, tool count, and reasoning replay behavior. Do not commit
keys, private prompts/results, or actual encrypted reasoning payloads; use
synthetic opaque values in fixtures.

The spike is **not yet run**. No available connection is a blocked validation,
not a pass. An unsupported field, malformed continuation, missing terminal
event, or requirement for different reasoning policy means stop and revise the
design. One failed experiment does not prove Responses itself cannot work.

## Minimal Protocol Selection

Keep the small selector alongside `buildPiModel` in `src/lib/agent/model.ts`;
do not introduce a generic routing framework or resolution-source hierarchy.

```ts
type ModelTransport = "openai-completions" | "openai-responses";

function resolveToolTransport(
  realModel: string,
  hasTools: boolean,
): ModelTransport {
  return hasTools && realModel === "gpt-6-astra"
    ? "openai-responses"
    : "openai-completions";
}
```

Match the exact upstream id, not all `gpt-*`, model labels, reasoning tags, or
connection-prefixed exposed ids. A plain-text user prompt with attached tools
still follows the tools-present rule.

This is a narrow application policy, not a claim that all providers serving
that name implement Responses. A failing connection reports an actionable
error; this release does not learn exceptions or fall back to reasoning-off.

## Responses Payload and Reasoning State

The installed Pi implementation requires explicit attention:

- `openai-responses.js` sets `store: false`.
- With `model.reasoning === false`, it does not request
  `reasoning.encrypted_content`.
- Setting `model.reasoning` to true alone can instead inject
  `reasoning.effort: "none"` when no reasoning option was supplied.
- `openai-responses-shared.js` stores reasoning output items as
  `thinkingSignature` and replays those items with function calls/results.

Use stateless replay with the upstream's default reasoning policy:

| Concern | Required behavior |
| --- | --- |
| Storage | Keep `store: false`; do not use `previous_response_id` |
| Reasoning effort | Do not inject `reasoning_effort` or `reasoning.effort` |
| Reasoning state | Add `reasoning.encrypted_content` to Responses `include` |
| Replay | Let Pi preserve and serialize reasoning items and call/result IDs |
| Tool definitions | Use Pi's converter, preserving descriptions and schemas |
| Historical models | Keep their current model flags and payload unchanged |

Implement the Responses-only payload policy using Pi's `onPayload` hook in
`src/lib/agent/provider.ts`, merging rather than replacing existing `include`
items. Keep the current `reasoning: false` declaration unless the spike proves
a different configuration is necessary; the hook requests replay state without
selecting a new effort level. Test actual SDK serialization, not only the model
object. Unsupported stateless reasoning replay is a planning gate failure.

Keep opaque reasoning items in the live Pi context. Existing UI reasoning text,
seed history, and chat persistence remain unchanged. Do not add database
columns or promise resumable in-flight tool execution after app restart.
Regression checks must cover a later user turn and reopening persisted history
without introducing orphaned provider item IDs.

## Failure Lifecycle: No Automatic Retry

The installed Pi SDK converts HTTP failures into stream `error` events.
`agent-loop.js` emits a final assistant message; `runtime.ts` forwards its
`errorMessage` through `onError`. An outer `agent.prompt()` catch is not a
reliable interception point for compatibility retries.

This release therefore performs no protocol-switch retry, no runtime restart
on compatibility errors, and no capability writes. Set Pi SDK transport retries
to zero for the new Responses path. Preserve the existing callbacks, and let
failed streams terminate through the normal error lifecycle, not success.

The gateway is the HTTP/error normalization boundary for the new path:

- Preserve upstream HTTP status and useful structured error fields. For an
  unstructured/HTML Responses error body, return a JSON error envelope using
  the gateway's existing error conventions instead of forwarding HTML.
- Include the selected Responses endpoint/model and an actionable upstream
  compatibility hint in error context without including credentials.
- Treat generic `404`/`405` as request rejection. Only describe endpoint
  non-support when the upstream body explicitly establishes it; a missing
  model, gateway route, or permission is a different failure.
- Handle `response.failed`, semantic error events, and premature EOF as
  failures. If a transport breaks after HTTP 200, emit a Responses-compatible
  SSE error frame before closing, retaining the original diagnostic message.
- Never execute tool arguments from a partial or failed response. A tool
  already executed before a later failure is not executed again automatically.

Keep the existing string-based UI error callback and persistence contract.
Structured data stays available in the gateway response/capture; no new
cross-layer error framework is needed.

## Gateway Observation and Documentation

Extend existing helpers in `wrapper/logging.ts`, `wrapper/gateway.ts`, and
`wrapper/observability.ts` rather than building another stream parser or logger.
Observe Responses frames without translating successful payloads.

| Input / outcome | Monitor behavior |
| --- | --- |
| `/v1/responses` | Protocol `openai-responses` |
| JSON `usage` | Map `input_tokens`, `output_tokens`, `total_tokens` |
| SSE terminal `response.usage` | Same mapping; do not double-count cumulative usage |
| `response.completed` then EOF | Success |
| `response.incomplete` | Preserve reason and usage; mark non-success (502 + diagnostic) |
| `response.failed` or semantic error | 502 + upstream diagnostic, even after HTTP 200 |
| EOF without terminal event / transport break | 502 + truncation diagnostic |
| Downstream cancellation | 499, not 502 |

These failure statuses describe monitor/log outcomes; they do not retroactively
change HTTP headers already sent. Preserve valid `response.incomplete` payloads
so Pi retains its existing output-limit semantics; do not disguise them as a
network exception. Ordinary HTTP rejections retain their actual status.

Parse incrementally across arbitrary chunk boundaries with bounded buffering.
Never overwrite a terminal failure with success on EOF or log the call twice.
Retain the existing redaction, body caps, and diagnostic logging policy.
Do not change Chat-Completions/Anthropic usage or termination behavior.

OpenAPI must document the Responses POST route, exposed model id, `input`,
function tools, stateless output-item replay, JSON response shape, semantic SSE
events, and structured errors. Do not advertise a new server-side conversation
or GET response-retrieval API.

## Compatibility and Rollback

| Request | Protocol / behavior |
| --- | --- |
| Pi `gpt-6-astra` with tools | Responses, only after the spike passes |
| Pi `gpt-6-astra` without tools | Chat Completions |
| Pi historical or unknown model | Chat Completions; no protocol-switch retry |
| Generic Direct Chat adapter | Existing Chat-Completions behavior |
| Volcengine / external AAP | Existing protocol behavior |

Rollback production selection by restoring Chat Completions in the small
selector. This restores prior behavior, including the original affected-model
limitation; it is not an alternative fix. Unused Pi Responses registration and
gateway observation support can remain or be reverted independently.
No cache, schema migration, or sync cleanup is required.

## Deferred Work

Automatic retry/learning and adapter tool execution require separate evidence
and scope approval. If retry is revisited, first define how raw HTTP status
survives SDK normalization, how rejected attempts are intercepted before UI
error callbacks, and how the selected API stays fixed across continuations.
Start with run-local state; persistent learning additionally needs expiration,
failure invalidation, account/route-change handling, and a no-sync policy.
