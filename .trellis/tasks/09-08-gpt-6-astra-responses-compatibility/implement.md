# GPT-6 Astra Responses Compatibility Implementation Plan

> **For agentic workers:** After implementation approval, use
> `subagent-driven-development` or `executing-plans` task-by-task. Checkboxes
> track execution; none are completed by this document revision.

**Goal:** Restore `gpt-6-astra` tool turns through the existing Pi runtime.

**Architecture:** Select one Pi API after resolving tools. Reuse Pi's tool loop
and stateless reasoning replay, with protocol-aware gateway diagnostics.
Leave Direct Chat adapters and capability persistence untouched.

**Tech Stack:** TypeScript, Pi 0.80.2, Vitest, Bun/Hono gateway, Tauri.

## Preconditions and File Boundaries

- Keep the task `planning` until the revised artifacts receive implementation
  approval. Editing this plan is not approval to run production changes.
- After approval, use an isolated worktree and the repository's Trellis
  activation/pre-development workflow. Do not commit without user authorization.
- Phase 0 gates all production implementation. Do not mark it passed from a
  mocked response, a single HTTP call, or an unavailable live connection.
- No dependency upgrades, Direct Chat type expansion, capability repository,
  sync registration, database migration, or automatic protocol retry.

| File | Responsibility |
| --- | --- |
| `src/lib/agent/model.ts` | Small exact-id selector and dual Pi model typing |
| `src/lib/agent/provider.ts` | Matching Pi API and Responses-only payload hook |
| `src/lib/agent/runtime.ts` | Resolve tools before selecting one runtime API |
| `src/lib/agent/tests/model-transport.test.ts` (new) | Routing matrix |
| `src/lib/agent/tests/responses-provider.test.ts` (new) | Real SDK serialization and stream normalization |
| `src/lib/agent/tests/responses-runtime.test.ts` (new) | Tool loop, callbacks, failures, cancellation |
| `src/lib/agent/tests/fixtures/responses/` (new) | Sanitized/synthetic stream fixtures |
| `vitest.config.ts` | Explicit allowlist entries for new frontend test files |
| `sidecar/gateway/wrapper/logging.ts` | Responses usage and bounded event observation |
| `sidecar/gateway/wrapper/gateway.ts` | Protocol label, error envelopes, stream outcome integration |
| `sidecar/gateway/wrapper/observability.ts` | Reuse/extend existing outcome helpers only as needed |
| `sidecar/gateway/wrapper/openapi.ts` | Responses endpoint and semantic event documentation |
| `sidecar/gateway/wrapper/tests/responses.test.ts` (new) | Route, usage, terminal outcomes, error framing, OpenAPI |
| `sidecar/gateway/wrapper/tests/logging.test.ts` | Existing usage/logging regression coverage |
| `sidecar/gateway/wrapper/tests/stream-error-propagation.test.ts` | Existing stream failure regression coverage |

Research paths below are relative to this task directory. Production/test paths
are relative to repository root. Generated OpenWiki pages must not be edited.

## Phase 0: Real Pi Tool-Loop Spike

- [ ] Confirm installed SDK versions and obtain an available affected connection.
  Record the upstream/proxy context without credentials. If unavailable, record
  the blocker and stop; do not build the remaining feature on assumed success.
- [ ] Create a minimal spike harness in the isolated worktree using Pi's
  `openAIResponsesApi()` and `Agent`. Use the real gateway, exposed model id,
  local gateway auth, current system role, and a side-effect-free echo tool.
  Keep the harness out of production entry points.
- [ ] Apply the proposed payload policy: `store: false`,
  `include: ["reasoning.encrypted_content"]`, no effort override, no
  `previous_response_id`, and no SDK retries.
- [ ] Stream the first response; require one actual function call. Let Pi
  execute the echo tool once and replay the result and reasoning items.
  Require a final `response.completed` and an answer using the echo result.
- [ ] Inspect both serialized upstream requests, including tool descriptions,
  schema, call/result IDs, and reasoning replay. Confirm there is no implicit
  `reasoning.effort: "none"` and no unexpected protocol-switch request.
- [ ] Run a historical Chat-Completions control with the same tool. Record
  whether later user turns and normal history seeding still work.
- [ ] Save findings to `research/pi-responses-spike.md`; save sanitized stream
  fixtures for Phase 1. Replace opaque encrypted values with synthetic test
  values and omit credentials/private content. Add the research note to both
  JSONL manifests only after it exists.
- [ ] Record PASS only after the full streamed loop succeeds. Otherwise return
  to design with the observed failing boundary; do not disable reasoning or
  introduce server-side state to make the gate pass.

## Phase 1: Pi Routing, Payload, and Runtime

### Routing and Serialization

- [ ] Add `model-transport.test.ts` and its Vitest allowlist entry. Cover:
  exact `gpt-6-astra` with/without tools; GPT-5, DeepSeek V4, Kimi K3, and unknown
  models with tools; nonmatching suffixes; and an exposed id whose `realModel`
  differs. Match the upstream id, but retain the exposed id in the wire payload.
- [ ] Run the new test and confirm a missing-selector/behavior failure, not a
  test discovery or import configuration error:

  ```sh
  pnpm exec vitest run src/lib/agent/tests/model-transport.test.ts
  ```

- [ ] Implement the small selector in `model.ts` and allow `buildPiModel` to
  build either Pi API type without changing historical fields:

  ```ts
  export type ModelTransport = "openai-completions" | "openai-responses";

  export function resolveToolTransport(
    realModel: string,
    hasTools: boolean,
  ): ModelTransport {
    return hasTools && realModel === "gpt-6-astra"
      ? "openai-responses"
      : "openai-completions";
  }
  ```

- [ ] Add `responses-provider.test.ts` and its allowlist entry. Drive the actual
  installed SDK with mocked fetch/SSE, not a fake serializer. Assert:
  `/responses`, exposed wire model id, `store: false`, merged encrypted-content
  include, no reasoning-off override, unchanged tool descriptions/schema,
  and replay of synthetic reasoning and tool-result items on the second call.
  A historical-model fixture must preserve the existing Chat payload.
- [ ] Run both tests red before adding Responses registration or payload policy:

  ```sh
  pnpm exec vitest run src/lib/agent/tests/model-transport.test.ts src/lib/agent/tests/responses-provider.test.ts
  ```

- [ ] In `provider.ts`, register `openAIResponsesApi()` only for the selected
  Responses model; otherwise keep `openAICompletionsApi()`. Use its `onPayload`
  hook to merge `reasoning.encrypted_content` into `include` and retain
  `store: false`. Keep upstream default effort, preserve any existing payload
  hook behavior, and set `maxRetries: 0` for this path.
- [ ] Re-run both tests green and inspect actual serialized fixtures before
  proceeding. Do not replace Pi conversion code with a handwritten adapter.

### Runtime and Error Lifecycle

- [ ] Add `responses-runtime.test.ts` and its allowlist entry. Mock gateway I/O
  and tool discovery, but exercise the real Pi agent loop. Cover tool resolution
  before selection, one tool execution, final continuation, and the existing
  assistant/reasoning/tool callback sequence.
- [ ] Add negative cases: exact compatibility `400` for an unknown model,
  Responses HTTP rejection, `response.failed`, premature EOF, abort, rejected
  checkpoint, and a continuation failure after one completed tool. Assert no
  automatic second attempt, no duplicate tool execution, no execution of partial
  failed calls, and no success callback for a failed assistant response.
- [ ] Confirm runtime tests fail against the old routing. Reorder
  `createAgentRuntime()` so `resolveAgent()` completes before selecting the API.
  Pass that single model/API to `createUnifiedRuntime()` and keep it fixed.
  Preserve callbacks and Pi's stream-error lifecycle; add no outer-catch retry.
- [ ] Add later-user-turn and persisted-history-seeding cases, without storing
  encrypted provider items in the chat database. Verify no orphaned item IDs.
- [ ] Run all three suites green:

  ```sh
  pnpm exec vitest run src/lib/agent/tests/model-transport.test.ts src/lib/agent/tests/responses-provider.test.ts src/lib/agent/tests/responses-runtime.test.ts
  ```

## Phase 2: Gateway Diagnostics and OpenAPI

- [ ] Add failing Bun tests in `responses.test.ts`, using a mock upstream and
  the real wrapper where practical. Check:
  - route lookup, authorization, exposed-to-real model rewrite, and
    `openai-responses` classification;
  - non-streaming `usage.input_tokens/output_tokens/total_tokens` and streamed
    terminal `response.usage`, including no double counting;
  - arbitrary SSE chunk boundaries, bounded buffering, exactly one log record,
    and no terminal failure overwritten at EOF;
  - completed=success, incomplete=502 diagnostic with reason/usage,
    failed/error=502, missing terminal/transport break=502, cancellation=499;
  - JSON errors for unstructured HTTP failures, preserved HTTP status and
    structured diagnostics, and no endpoint-unsupported claim from an
    ambiguous `404`;
  - Responses-compatible SSE error framing on transport failure, readable by
    the installed Pi SDK, while preserving existing Chat/Anthropic framing;
  - OpenAPI endpoint presence and the documented request/response fields.
- [ ] Run the new suite red from repository root:

  ```sh
  bun test ./sidecar/gateway/wrapper/tests/responses.test.ts
  ```

- [ ] Extend the existing usage/parser helpers to observe Responses events and
  map the design's terminal outcome table. Integrate those outcomes into
  `instrumentResponse`; preserve successful wire frames and actual HTTP
  rejection status. Do not change headers retroactively after streaming starts.
- [ ] Normalize Responses errors at the gateway boundary. Preserve useful
  upstream codes/messages, add endpoint/model context, and return structured
  JSON/SSE instead of HTML or a silent close. Keep redaction and body limits.
  Preserve valid incomplete events; they retain Pi's output-limit semantics.
- [ ] Add Responses OpenAPI documentation for exposed model ids, `input`,
  function tools, stateless replay, JSON output, semantic SSE, and error cases.
  Do not advertise response retrieval or server-side conversation features.
- [ ] Run the new tests plus all existing gateway regressions green, then
  rebuild the sidecar:

  ```sh
  bun test ./sidecar/gateway/wrapper/tests
  pnpm run sidecar:gateway:build
  ```

## Phase 3: Full Regression and Desktop Acceptance

- [ ] Run these commands from repository root. No command changes the working
  directory for the next command:

  ```sh
  pnpm test
  pnpm build
  bun test ./sidecar/gateway/wrapper/tests
  pnpm run sidecar:gateway:build
  git diff --check
  ```

- [ ] Start the desktop app using the freshly rebuilt gateway. In ordinary chat,
  DataAgent, and ResearchAgent, verify `gpt-6-astra` tool requests use Responses,
  execute the requested tool once, and continue after its result. In the
  ResearchAgent path, approve, reject, and stop a checkpoint.
- [ ] Verify GPT-5, DeepSeek V4, and Kimi K3 tool requests retain Chat Completions.
  Record unavailable live providers as unverified, not passing.
- [ ] Verify a deliberately tool-free Pi request remains on Chat Completions.
  Do not use a plain-text prompt with default internal tools as this test.
- [ ] Verify the generic Direct Chat adapter is unchanged and uses its configured
  upstream URL/model. Do not require an adapter streaming tool loop or expect
  its direct upstream calls to appear in the embedded Gateway Monitor.
- [ ] Check Monitor protocol, input/output/total usage, failed/incomplete stream
  diagnostics, and cancellation outcome against the captured upstream frames.
- [ ] Send a later user turn, reopen a persisted session, and confirm existing
  history behavior without adding a new provider-state persistence contract.
- [ ] Review the final diff against PRD/design. Confirm there are no new retry
  guards, capability stores, Direct Chat tool contracts, schema changes, or
  unrelated dependency edits. Record actual verification results before asking
  for commit/integration approval.

## Rollback and Deferred Work

- Restore Chat Completions in the small selector to restore prior routing,
  acknowledging that the original affected-model limitation then returns.
- Revert Responses payload/registration independently if needed; no persisted
  cache or schema needs cleanup.
- Gateway diagnostics can remain for external Responses callers; reverting
  them does not change model routing.
- Automatic retry/learning and a Direct Chat tool loop are separate future
  tasks, not unfinished phases or acceptance blockers for this release.
