# Phase 0 Spike — GPT-6 Astra Responses Tool Loop

This directory holds the **throwaway** validation harness for the design's
Phase 0 gate. It proves — against a **real `gpt-6-astra` upstream** routed
through the **running desktop Unified gateway** — that Pi's Responses API can
complete a streamed tool loop with stateless reasoning replay, before any
production code is written.

> ⚠️ Nothing here is production code. It lives entirely under the task dir and
> is excluded from `tsconfig`/`vitest`. Delete `out/` (and this folder) once the
> findings are captured. Do **not** commit the `out/` artifacts if they contain
> anything sensitive — the harness sanitizes encrypted reasoning + credentials,
> but review before committing.

## Prerequisites

1. The desktop app is running with the local **Unified gateway started**
   (Unified page → gateway shows *running*).
2. You have a **connection whose upstream serves `gpt-6-astra`** enabled in the
   app, so the gateway exposes a model id ending in `/gpt-6-astra`.
3. Node **24+** (this repo's toolchain). No build step — Node runs the `.mts`
   file directly. `openai` resolves transitively through `pi-ai`.

## Find your gateway parameters

- **Port / local key**: Unified page in the app, or the stored config
  (`unifiedApiConfig`; defaults to port `4141`, empty key). If you set a local
  key, pass it as `GATEWAY_LOCAL_KEY`; if empty, omit it.
- **Exposed model id**: list what the gateway actually exposes:

  ```sh
  # no key configured:
  curl -s http://127.0.0.1:4141/v1/models | python3 -m json.tool | grep -i astra
  # with a local key:
  curl -s http://127.0.0.1:4141/v1/models -H "Authorization: Bearer $GATEWAY_LOCAL_KEY" | python3 -m json.tool | grep -i astra
  ```

  Use the full exposed id (e.g. `my-conn/gpt-6-astra`), **not** the bare
  upstream id. The gateway rewrites it to the real upstream model automatically.

## Run

From the repo root:

```sh
GATEWAY_PORT=4141 \
GATEWAY_LOCAL_KEY='' \
EXPOSED_MODEL='<connName>/gpt-6-astra' \
node .trellis/tasks/09-08-gpt-6-astra-responses-compatibility/research/spike/spike.mts
```

The harness will:

1. Build a Pi `Agent` on the **Responses** API with the design's payload policy
   (`store:false`, `include:["reasoning.encrypted_content"]`, **no** effort
   override, `maxRetries:0`) via the `onPayload` hook.
2. Stream one turn asking the model to call a side-effect-free `echo` tool once,
   let Pi execute it, replay the function call + result + reasoning items, and
   require a final `stop` with an answer that quotes the echoed phrase.
3. Run a **Chat-Completions control** with the same tool for comparison.
4. Write artifacts to `./out/` and print a PASS/FAIL summary.

## Interpreting the result

`out/summary.json` records the gate decision. **PASS** requires all of:

| Check | Field | Expected |
| --- | --- | --- |
| No stream/HTTP error | `responses.errorMessage` | `null` |
| Echo executed exactly once | `responses.toolCalls` | `1` |
| Initial + continuation replay | `responses.upstreamRequestCount` | `>= 2` |
| Reached terminal completion | `responses.terminalStatus` | `"stop"` |
| Final answer used the tool result | `responses.finalAnswerUsesEcho` | `true` |
| No implicit reasoning-off override | `responses.sawImplicitEffortOverride` | `false` |
| Encrypted-content replay requested | `responses.sawEncryptedContentInclude` | `true` |

Inspect the serialized requests to confirm the wire shape:

- `out/responses-request-1.json` — first request: `input`, function tool schema
  (descriptions preserved), `store:false`, `include` has
  `reasoning.encrypted_content`, and **no** `reasoning.effort`.
- `out/responses-request-2.json` — continuation: the prior `function_call`,
  `function_call_output`, and `reasoning` items replayed statelessly (encrypted
  payloads shown as a synthetic marker).
- `out/responses-events.jsonl` — the stream event sequence.
- `out/completions-*` — the control run for side-by-side comparison.

### FAIL handling (per design.md / implement.md)

A FAIL is **not** an implementation problem to work around. Per the plan:

- An unsupported field, malformed continuation, missing terminal event, or a
  requirement for a *different* reasoning policy means **stop and revise the
  design** — do **not** disable reasoning or add server-side state to force a
  pass.
- "No available connection" is a **blocked validation, not a pass.**
- One failed experiment does not prove Responses itself cannot work; capture the
  exact failing boundary.

If the reported `400` (`Function tools with reasoning_effort are not
supported…`) reappears here, record the full request that triggered it —
that is the decisive evidence about whether the stateless `include`-only
approach is accepted by this upstream.

## After the run

1. Fill in `../pi-responses-spike.md` (findings note) with: SDK version, the
   `summary.json` verdict, the two serialized request shapes, event sequence,
   tool-execution count, and reasoning-replay behavior. **Redact** anything
   sensitive; use the sanitized `out/` files.
2. Copy sanitized stream fixtures needed for Phase 1 offline tests into the
   production fixtures dir when implementing
   (`src/lib/agent/tests/fixtures/responses/`).
3. Hand the verdict back so Phases 1–3 can proceed (on PASS) or the design can
   be revised (on FAIL).

## Environment variables

| Var | Required | Default | Meaning |
| --- | --- | --- | --- |
| `EXPOSED_MODEL` | yes | — | Gateway-exposed id ending in `/gpt-6-astra` |
| `GATEWAY_PORT` | no | `4141` | Local Unified gateway port |
| `GATEWAY_LOCAL_KEY` | no | `` (empty) | Local bearer key if you configured one |
