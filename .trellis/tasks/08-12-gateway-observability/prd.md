# Gateway error surfacing and structured disk logging

## Goal

Make gateway/agent failures self-explanatory and diagnosable after the fact,
without adding noisy logs. Triggered by an in-app agent run that failed with the
opaque red text `The resource id 3309130990 is invalid.` while the sidecar only
logged `socket connection was closed unexpectedly` / `Failed to parse JSON`,
with no way to correlate the two.

## Root cause (for context)

Agent LLM calls stream from the Portkey sidecar over `http://127.0.0.1:4141/v1`
through the `gatewayFetch.ts` plugin-http shim. When the upstream stream breaks
mid-flight, the gateway (already having sent `200 text/event-stream`) just tears
the stream down. plugin-http's next read hits a dropped body resource and throws
Tauri's `The resource id {id} is invalid.`, which surfaces verbatim in the chat.
The raw failure context (provider, real model, upstream status/body) is only in
console/stderr and is never correlated with the failing turn.

## Requirements

### Tier 1 — make errors self-explanatory
- Gateway streaming failures must emit a structured SSE error terminator
  (`data: {"error":{...}}` + `data: [DONE]`) before closing, so the client sees
  a real error instead of a torn stream / invalid-resource-id.
- The in-app chat error must be humanized: detect the Tauri
  `The resource id ... is invalid.` pattern (and the socket-closed / JSON-parse
  family) and rewrite it to a readable, localized message that names the failure
  as an upstream stream interruption and suggests a retry.

### Tier 2 — structured disk logging (default-quiet)
- The sidecar writes completed call logs to a rolling JSONL file under the app
  config dir (`logs/gateway-YYYYMMDD.jsonl`), rotating by date.
- Default is quiet: only calls with `status >= 400` or a non-null `error` are
  written. An env flag (`GATEWAY_LOG_ALL=1`) enables full-volume logging.
- Non-call-log `[gateway]` diagnostic lines (Portkey `retryRequest` /
  `tryTargetsRecursively`, banners) are captured to the same JSONL as
  timestamped `level: "warn"` records, so Portkey diagnostics correlate with the
  model call that produced them.
- Streaming failures must persist whatever upstream response text was seen
  (even if empty, annotated) so the last bytes before a break are inspectable.

## Constraints
- No new heavyweight logging framework on the frontend; reuse existing patterns.
- Logging must never break a request (best-effort, swallow its own errors).
- Bodies/logs stay bounded (respect existing `MAX_BODY_CHARS`, date rotation).
- Chinese-first user-facing strings, consistent with existing i18n.

## Acceptance Criteria

- [x] Gateway streaming error path enqueues an SSE error frame + `[DONE]` before closing.
- [x] `normalizeAgentErrorMessage` (or equivalent) rewrites the invalid-resource-id / socket-closed / JSON-parse errors into a readable localized message; unit-tested.
- [x] Sidecar appends completed call logs to `logs/gateway-YYYYMMDD.jsonl`, default-quiet (errors only), full volume under `GATEWAY_LOG_ALL=1`.
- [x] Portkey diagnostic `[gateway]` lines are captured to the JSONL as timestamped warn records.
- [x] Streaming failures persist the seen upstream body (annotated when empty).
- [x] `pnpm build` and `pnpm test` pass.
- [x] Monitor UI exposes a "打开日志目录 / Open logs" button that reveals `<app_config_dir>/logs` in the OS file manager (`unified_api_open_logs_dir`).

## Notes
- Files in scope: `sidecar/gateway/wrapper/gateway.ts`, `sidecar/gateway/wrapper/logging.ts`, `src/lib/agent/runtime.ts`, `src/pages/agent/AgentChatView.tsx` (error normalization), plus i18n and tests.
- Lightweight task: PRD-only.
