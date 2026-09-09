# Pi Responses Spike — Findings

> Status: **PASS.** Executed against the real `gpt-6-astra` upstream through the
> running desktop Unified gateway on 2026-09-09. The Chat-Completions control
> reproduced the exact production `400`, confirming both the necessity and the
> correctness of the Responses fix. Production implementation (Phases 1–3) is
> unblocked.

## Verdict

- Result: **PASS**
- Date run: 2026-09-09
- Run by: xjhznick (local desktop, gateway running)

## Environment

- Pi SDK: `@earendil-works/pi-ai` and `@earendil-works/pi-agent-core` — both `0.80.2`.
- Node: `v24.19.0` (runs `.mts` directly; no build step). `openai@6.26.0`
  resolves transitively through pi-ai.
- Gateway: local Unified gateway, port `4141`, local key set: **yes**.
- Exposed model id: `Model-Hub/gpt-6-astra` (upstream real id `gpt-6-astra`,
  rewritten by the gateway's generic `/v1/*` handler).
- Upstream/proxy: Model-Hub provider serving `gpt-6-astra`.

## Responses tool loop (the gate)

From `research/spike/out/summary.json`:

| Check | Observed | Required |
| --- | --- | --- |
| `errorMessage` | `null` | null ✓ |
| `toolCalls` | `1` | 1 ✓ |
| `upstreamRequestCount` | `2` | ≥ 2 ✓ |
| `terminalStatus` | `"stop"` | `stop` ✓ |
| `finalAnswerUsesEcho` | `true` | true ✓ |
| `sawImplicitEffortOverride` | `false` | false ✓ |
| `sawEncryptedContentInclude` | `true` | true ✓ |

Final answer: `The tool returned "ECHO:astra-responses-spike-42".`

### Request 1 (initial) — shape (`out/responses-request-1.json`)

- Endpoint: Responses (`input`-based payload).
- `store: false`.
- `include: ["reasoning.encrypted_content"]` — present, added via `onPayload`.
- **No `reasoning` / `reasoning.effort` field at all** — confirms the design's
  key claim: with `model.reasoning:false`, Pi injects neither an effort override
  nor `reasoning.effort:"none"`; the hook adds only the `include`.
- `tools[0]` is a `function` with description + JSON schema preserved verbatim.

### Request 2 (continuation) — stateless replay (`out/responses-request-2.json`)

- Same system + user input, then the replayed items:
  - `{ type: "function_call", id: "fc_…", call_id: "call_…", name: "echo",
    arguments: "{\"text\":\"astra-responses-spike-42\"}" }`
  - `{ type: "function_call_output", call_id: "call_…",
    output: "ECHO:astra-responses-spike-42" }`
- `store:false` and the same `include` carried forward.
- Note: for this simple turn the model emitted **no** encrypted `reasoning`
  item, so none needed replaying. Pi's replay path (`thinkingSignature` →
  reasoning item) is still exercised in code; when the model does emit reasoning
  it will be serialized. The `include` request is what makes that possible, and
  its absence here is a model/turn characteristic, not a harness failure.

### Event sequence (`out/responses-events.jsonl`, 45 agent events)

`agent_start → turn_start → message_start → message_update(×N) →
tool_execution_start → tool_execution_end → (2nd turn) message_start →
message_update(×N) → message_end → turn_end → agent_end`. The tool executes
between two assistant turns exactly once.

## Chat-Completions control (`out/completions-*`)

- `errorMessage`: **`400 openai error: … Function tools with reasoning_effort
  are not supported for this model in /v1/chat/completions. To use function
  tools, use /v1/responses or set reasoning_effort to 'none'.`**
- `toolCalls`: 0, `terminalStatus`: `error`, single upstream request.
- This is the **exact** production symptom, reproduced with the identical tool
  over Completions — proving the model rejects tool turns on `/chat/completions`
  even though our payload never explicitly sets `reasoning_effort` (it is a
  model-default/proxy-applied reasoning behavior, as the PRD hypothesized).

## Decision

**Proceed to Phase 1** with these fixtures. The exact-id transport selector,
the `onPayload` policy (`store:false` + merge `reasoning.encrypted_content`, no
effort override, `maxRetries:0`), and the tool-resolution reorder are all
validated by real wire payloads captured here. Sanitized request/event fixtures
under `research/spike/out/` seed the Phase 1 offline tests
(`src/lib/agent/tests/fixtures/responses/`).

## Post-implementation live integration check

After implementing all phases, the freshly-built sidecar binary was run on a
spare port (4142) chained in front of the live gateway (4141) and driven through
the same Responses tool loop. Monitor log confirmed:

- Both Responses calls: `protocol: "openai-responses"`, `status: 200`, usage
  mapped from terminal `response.usage` (input/output/total = 139/23/162 and
  182/19/201), no error; continuation replays `function_call` +
  `function_call_output` statelessly.
- Chat control: `protocol: "openai-chat"`, `status: 400` (distinct), reproducing
  the upstream compatibility error.

This validated the integrated gateway `instrumentResponsesStream` path
(protocol classification, usage mapping, success/failure distinction) against
the real upstream, not just unit fixtures.
