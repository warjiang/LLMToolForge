# LLMToolForge gateway sidecar

A self-contained local AI gateway compiled to a single binary and supervised by
the Tauri backend. It is the front door for external tools (Codex, Claude Code,
generic OpenAI/Anthropic clients) and exposes the user's connected models on a
local port.

## Architecture

```
client ──HTTP──▶ gateway sidecar (127.0.0.1:<port>)
                   ├─ wrapper/ : local-key auth, model listing, routing,
                   │             Anthropic⇄OpenAI bridge, call logging, docs
                   └─ portkey/ : vendored Portkey gateway (protocol translation,
                                 provider transports, /v1/chat/completions, …)
```

- `wrapper/gateway.ts` — entry point. Hono app: `GET /`, `/health`,
  `/openapi.json`, `/docs`, `/v1/models`, `POST /v1/messages` (Anthropic bridge),
  and a generic `POST /v1/*` that resolves the model route, injects Portkey
  headers, and delegates to the embedded Portkey app.
- `wrapper/config.ts` — loads/watches the JSON routing config the Rust
  supervisor writes (`--config=<path>`), so config changes apply without a
  restart.
- `wrapper/anthropic.ts` — Anthropic Messages ⇄ OpenAI Chat translation
  (streaming + tools), used for `/v1/messages` because Portkey does not translate
  Anthropic requests to OpenAI-compatible upstreams.
- `wrapper/logging.ts` — emits `@@LLMTF_CALLLOG@@{json}` lines on stdout that the
  Rust supervisor parses into its call-log ring buffer and frontend event.
- `wrapper/openapi.ts` — the OpenAPI 3.1 document and Redoc docs page.
- `portkey/` — vendored Portkey gateway (MIT). See `NOTICE.md`.

## Develop

Requires [Bun](https://bun.sh).

```sh
bun install
# run against a config file written by the app (or a hand-made one)
bun run wrapper/gateway.ts --port=4141 --config=/path/to/gateway-config.json
```

Config file shape:

```json
{
  "localKey": "sk-local-…",
  "routes": {
    "volcengine/doubao-pro": {
      "provider": "volcengine",
      "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
      "apiKey": "<upstream key>",
      "realModel": "ep-…"
    }
  }
}
```

## Build

`build.ts` compiles a self-contained binary named for Tauri's `externalBin`
convention into `../../src-tauri/binaries/`:

```sh
bun run build.ts                          # host target triple
bun run build.ts --target=x86_64-apple-darwin   # cross-compile
```

Output: `src-tauri/binaries/portkey-gateway-<rust-target-triple>[.exe]`.
These binaries are gitignored and produced in CI before `tauri build`.
