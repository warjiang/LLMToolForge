# Gateway observability P1 fixes

## Scope

Fix the five P1 findings from the worktree review without replacing the Portkey
gateway or introducing a logging framework.

## Design

### Stream error propagation

Portkey's `handleStreamingMode` must propagate failures from `readStream` and
`readAWSStream` by aborting its transform writer. The wrapper remains the
protocol boundary: it catches the rejected body read, emits the OpenAI or
Anthropic SSE error frame, records status 502, and closes the client stream.

### Diagnostic capture

Console capture must not serialize arbitrary values. A pure formatter accepts
only known gateway/Portkey diagnostic prefixes, keeps the prefix plus
`Error.name`/`Error.message`, redacts credential-shaped values, and truncates the
result to a fixed maximum. Raw chunks, response objects, headers, and arbitrary
plain-string arguments are excluded.

### Runtime-aware chat errors

Gateway error classification applies only to the built-in Pi runtime, whose
model traffic uses the Unified gateway. External AAP runtime errors remain
verbatim because the same phrases may describe the child process or protocol
rather than an upstream model.

### Cancellation status

An upstream failure is status 502. A downstream/client cancellation is status
499. Both remain observable, but cancellation is not represented as an upstream
failure.

### Bounded disk logs

Daily JSONL files have a fixed size cap and one rotated backup. Files older than
a fixed retention window are removed during initialization and date changes.
Diagnostic records are individually bounded before serialization. All file
operations remain best-effort and must not affect requests.

## Testing

- Bun tests cover Portkey stream rejection propagation and wrapper logging
  helpers.
- Vitest covers built-in versus external runtime error normalization.
- Logging tests use temporary directories to cover redaction, truncation,
  status persistence, size rotation, and retention cleanup.
- Final verification runs the targeted tests, `pnpm test`, `pnpm build`, and the
  sidecar compile command.
