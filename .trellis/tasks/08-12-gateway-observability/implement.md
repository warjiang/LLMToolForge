# Gateway Observability P1 Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven-development and
> execute the tasks in order. Do not modify production code before the
> corresponding failing test is observed.

**Goal:** Fix the five reviewed gateway observability defects while preserving
the existing Unified gateway API and default-quiet behavior.

**Architecture:** Portkey propagates stream failures to the wrapper; a focused
observability helper owns safe diagnostic formatting and stream outcome
classification; `logging.ts` owns bounded file retention. Agent error
normalization receives an explicit runtime-source flag.

**Tech Stack:** TypeScript, Bun Web Streams/Bun test, React, Vitest, Tauri Rust.

---

### Task 1: Propagate Portkey stream failures

**Files:**
- Modify: `sidecar/gateway/portkey/src/handlers/streamHandler.ts`
- Create: `sidecar/gateway/wrapper/tests/stream-error-propagation.test.ts`

- [x] Create a response body whose `pull()` raises `Error("upstream broke")`,
  pass it through `handleStreamingMode`, and assert reading the returned body
  rejects with that error.
- [x] Run
  `bun test wrapper/tests/stream-error-propagation.test.ts` from
  `sidecar/gateway`; expect failure because Portkey currently closes the writer.
- [x] Replace the two error-path `writer.close()` calls with
  `writer.abort(error)`, while retaining normal-path `writer.close()`.
- [x] Re-run the targeted Bun test; expect pass.

### Task 2: Bound and sanitize diagnostic capture

**Files:**
- Create: `sidecar/gateway/wrapper/observability.ts`
- Create: `sidecar/gateway/wrapper/tests/observability.test.ts`
- Modify: `sidecar/gateway/wrapper/gateway.ts`

- [x] Test that known `retryRequest`, `tryTargetsRecursively`,
  `Error during stream processing`, `Failed to parse JSON`, and `[gateway]`
  prefixes produce a diagnostic string.
- [x] Test that a `Chunk:` argument and arbitrary objects are omitted, bearer
  tokens/API keys are replaced by `[redacted]`, and output length never exceeds
  `MAX_DIAGNOSTIC_CHARS`.
- [x] Run `bun test wrapper/tests/observability.test.ts`; expect module-not-found
  or missing-export failure.
- [x] Implement
  `formatGatewayDiagnostic(args: unknown[]): string | null` with an explicit
  prefix allowlist, `Error` extraction, credential redaction, and truncation.
- [x] Replace `safeStringify` and unrestricted argument joining in
  `installDiagnosticCapture` with the pure formatter.
- [x] Re-run the targeted Bun test; expect pass.

### Task 3: Keep external AAP errors verbatim

**Files:**
- Modify: `src/pages/agent/agentError.ts`
- Modify: `src/pages/agent/tests/agent-error.test.ts`
- Modify: `src/pages/agent/AgentChatView.tsx`

- [x] Add tests for
  `normalizeAgentErrorMessage(raw, translate, classifyGatewayErrors)`: the same
  closed-connection message localizes when the flag is true and stays raw when
  false; cancellation quote stripping remains unchanged.
- [x] Run
  `pnpm vitest run src/pages/agent/tests/agent-error.test.ts`; expect failure
  because normalization is not exported from the pure module.
- [x] Move normalization into `agentError.ts`, export it, and conditionally call
  `classifyAgentError` only when `classifyGatewayErrors` is true.
- [x] In `runAgentTurn`, pass `def.kind !== "external"` to normalization.
- [x] Re-run the targeted Vitest file; expect pass.

### Task 4: Distinguish cancellation from upstream failure

**Files:**
- Modify: `sidecar/gateway/wrapper/observability.ts`
- Modify: `sidecar/gateway/wrapper/tests/observability.test.ts`
- Modify: `sidecar/gateway/wrapper/gateway.ts`

- [x] Add tests for `streamLogStatus`: no error keeps the upstream status,
  upstream errors map to 502, and client cancellation maps to 499.
- [x] Run the targeted Bun test; expect missing-export failure.
- [x] Implement the pure status helper and change both OpenAI and Anthropic
  `done` callbacks to accept `"success" | "upstream_error" |
  "client_cancelled"` instead of inferring status from a string.
- [x] Re-run the targeted Bun test; expect pass.

### Task 5: Bound daily JSONL storage

**Files:**
- Modify: `sidecar/gateway/wrapper/logging.ts`
- Create: `sidecar/gateway/wrapper/tests/logging.test.ts`

- [x] Using a temporary config directory, test that initialization removes
  gateway logs older than `LOG_RETENTION_DAYS`.
- [x] Test that repeated bounded diagnostic records rotate the current daily
  file at `MAX_DISK_LOG_BYTES`, retain only one backup, and never write a line
  larger than the diagnostic cap.
- [x] Run `bun test wrapper/tests/logging.test.ts`; expect failures because no
  cleanup or size rotation exists.
- [x] Add best-effort retention cleanup, byte-aware pre-append rotation, and one
  backup per day. Reset `logDir` at each `initDiskLog` call so configuration is
  deterministic.
- [x] Re-run the targeted Bun test; expect pass.

### Task 6: Full verification

**Files:**
- Update: `.trellis/spec/frontend/agent-chat-provider-contracts.md` only if the
  final behavior differs from its current contracts.

- [x] Run all wrapper tests:
  `cd sidecar/gateway && bun test wrapper/tests`.
- [x] Run `pnpm test`; expect all Vitest files pass.
- [x] Run `pnpm build`; expect TypeScript and Vite build pass.
- [x] Run `pnpm run sidecar:gateway:build`; expect the sidecar binary compiles.
- [x] Run `git diff --check`; expect no whitespace errors.
- [x] Review the full diff against the task PRD and the five P1 findings.
