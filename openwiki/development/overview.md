---
type: Guide
title: Development Guide
description: Developer guide for LLMToolForge — build system, testing, CI/CD, external agent platform SDKs (Python/Node), and skill development.
tags: [development, build, testing, ci, sdk, platform]
---

# Development Guide

How to build, test, and extend LLMToolForge. Covers the build pipeline, CI/CD, external agent SDKs, and skill development.

## Build System

### Prerequisites

- **Node.js** + **pnpm** (package manager: `pnpm@9.15.9`)
- **Rust** toolchain (for Tauri)
- **Bun** (for building sidecar binaries)

### Commands

| Command | Description |
|---|---|
| `pnpm install` | Install all dependencies |
| `pnpm dev` | Frontend-only dev server (browser, data in localStorage) |
| `pnpm build` | TypeScript check + Vite production build |
| `pnpm run sidecar:build` | Build both sidecar binaries (gateway + connector) |
| `pnpm run sidecar:gateway:build` | Build only the Portkey gateway sidecar |
| `pnpm run sidecar:connector:build` | Build only the OpenConnector sidecar |
| `pnpm tauri:dev` | Full Tauri desktop app in dev mode |
| `pnpm tauri:build` | Production desktop installer |
| `pnpm clean` | Clean build artifacts |

The sidecar build uses **Bun** to compile TypeScript into standalone binaries:
- Gateway: `sidecar/gateway/build.ts`
- Connector: `sidecar/connector/build.ts` (clones open-connector at a pinned commit, applies `node:sqlite`→`bun:sqlite` compatibility shim)

**Important**: After a fresh clone or `pnpm clean`, the `src-tauri/binaries/` directory is empty (binaries are gitignored). Run `pnpm run sidecar:build` before `pnpm tauri:dev` or you'll get `resource path ... doesn't exist`.

### Project Structure for Builds

```
src-tauri/
├── binaries/           # Sidecar binaries (gitignored, built locally)
├── icons/              # App and tray icons
├── src/                # Rust source
├── Cargo.toml          # Rust dependencies
└── tauri.conf.json     # Tauri configuration

sidecar/
├── gateway/            # Portkey gateway (Bun/TS)
│   └── build.ts        # Bun build script
├── connector/          # OpenConnector (Bun/TS)
│   ├── build.ts        # Bun build script
│   └── UPSTREAM.json   # Pinned upstream commit reference
└── node_modules/       # Sidecar build dependencies
```

## CI/CD

GitHub Actions workflows in [`.github/workflows/`](/.github/workflows/):

| Workflow | File | Purpose |
|---|---|---|
| **CI** | [`ci.yml`](/.github/workflows/ci.yml) | Lint + build + test on push/PR |
| **Release** | [`release.yml`](/.github/workflows/release.yml) | Platform-specific builds and release publishing |
| **OpenWiki Update** | [`openwiki-update.yml`](/.github/workflows/openwiki-update.yml) | Scheduled wiki refresh (recently added) |

### CI Notes

- Sidecar must be built before Rust checks (connector build is a prerequisite, see PR #54)
- Windows CI uses `rustls-ring` TLS to avoid `aws-lc-sys` / NASM dependency
- The `russh` SSH crate also uses `ring` backend for the same reason

## Platform SDKs — External Agent Development

The [`/platform/`](/platform/) directory contains SDKs and examples for building external agents that run as subprocesses via the [AAP protocol](/openwiki/agent/overview.md).

### Node.js SDK (`@llmtoolforge/agent-sdk`)

**Location**: [`/platform/node/`](/platform/node/)

| File | Purpose |
|---|---|
| [`src/runtime.js`](/platform/node/src/runtime.js) | AAP loop + `TurnContext` — reads AAP messages from stdin, dispatches turns, writes `@@AAP@@`-prefixed output |
| [`src/model.js`](/platform/node/src/model.js) | Unified model config from `init` message + env vars |
| [`src/adapters/vercel-ai.js`](/platform/node/src/adapters/vercel-ai.js) | Vercel AI SDK adapter |

### Python SDK (`llmtoolforge-agent`)

**Location**: [`/platform/python/`](/platform/python/)

| File | Purpose |
|---|---|
| [`llmtoolforge_agent/runtime.py`](/platform/python/llmtoolforge_agent/runtime.py) | AAP loop + `TurnContext` |
| [`llmtoolforge_agent/model.py`](/platform/python/llmtoolforge_agent/model.py) | Unified model config |
| [`llmtoolforge_agent/adapters/langchain.py`](/platform/python/llmtoolforge_agent/adapters/langchain.py) | LangChain adapter |

### Reference Agent (Framework-Free)

**Location**: [`/platform/examples/echo-agent/`](/platform/examples/echo-agent/)

A minimal, framework-free AAP implementation used as a reference and for protocol testing. Includes a test harness.

### Agent Package Format

External agents use an `agent.json` manifest:

```json
{
  "id": "my-agent",
  "name": "My Agent",
  "description": "Agent description",
  "runtime": "python",
  "entry": "main.py",
  "framework": "langgraph",
  "defaults": {
    "model": "",
    "temperature": 0.7,
    "maxTokens": 4096,
    "systemPrompt": ""
  }
}
```

On install, the Rust host builds an isolated environment:
- **Python**: `uv venv` + `uv pip install -e .`
- **Node**: `pnpm install`

### AAP Protocol Compliance

When building an external agent, the key contract is:

1. Read JSON from **stdin** (one per line)
2. On `init`, configure the model client to use `config.baseUrl` with `config.localKey` as Bearer token and `config.model` as the model name
3. Send `User-Agent: {config.userAgent}` header for call-monitor attribution
4. Write JSON responses to **stdout** prefixed with `@@AAP@@`
5. Plain stdout lines (without marker) are diagnostic logging
6. Handle `abort` by stopping the current turn and emitting `done`
7. Handle `prompt.images` (v2) for native vision input when your framework supports it

Full spec: [`/src/lib/agent/aap/PROTOCOL.md`](/src/lib/agent/aap/PROTOCOL.md)

## Testing

### Frontend Tests

- Store tests: [`/src/store/tests/`](/src/store/tests/)
- Data tests: [`/src/data/tests/`](/src/data/tests/)
- Agent tests: [`/src/pages/agent/tests/`](/src/pages/agent/tests/)

### Platform SDK Tests (Offline, No Network)

```bash
# Protocol + interaction reuse (framework-free)
node platform/examples/echo-agent/test-harness.mjs

# Node SDK core + Vercel adapter mapping
node platform/node/test/runtime.test.mjs

# Python SDK core + LangChain adapter mapping
python3 platform/python/tests/test_runtime.py
```

### Image Agent Test Fixtures

Recent test fixtures for the image input feature:

| File | Purpose |
|---|---|
| [`/platform/node/test/fixtures/image-agent.mjs`](/platform/node/test/fixtures/image-agent.mjs) | Node SDK image handling test |
| [`/platform/python/tests/fixtures/image_agent.py`](/platform/python/tests/fixtures/image_agent.py) | Python SDK image handling test |

## Skill Development

### Write-Connector Skill

The [`/skills/write-connector/`](/skills/write-connector/) skill provides guidance for developing new OpenWiki connectors. It follows the skill format with `SKILL.md` as the entry point.

### Skill File Format

Skills support a multi-file format:
```
skill-name/
├── SKILL.md            # Required: YAML frontmatter + markdown content
├── references/         # Optional: reference documents
├── scripts/            # Optional: executable scripts
└── …                  # Other resources (binary files as base64)
```

`SKILL.md` frontmatter can declare external requirements:
```yaml
---
name: my-skill
description: Does something useful
metadata:
  requires:
    bins: [lark-cli, jq]
---
```

## Configuration Files

| File | Purpose |
|---|---|
| [`/package.json`](/package.json) | Node dependencies, scripts, metadata |
| [`/src-tauri/Cargo.toml`](/src-tauri/Cargo.toml) | Rust dependencies, crate metadata |
| [`/vite.config.ts`](/vite.config.ts) | Vite build configuration |
| [`/tailwind.config.js`](/tailwind.config.js) | Tailwind CSS theme (Geist design system, dark/light) |
| [`/tsconfig.json`](/tsconfig.json) | TypeScript configuration |
| [`/postcss.config.js`](/postcss.config.js) | PostCSS with Tailwind + autoprefixer |

## Tooling Overlays

The repository uses two agent-oriented tooling overlays in addition to OpenWiki:

- **Trellis** (`.trellis/`): Development workflow management — phases, task tracking, spec guidelines, workspace journals. Referenced in `AGENTS.md`.
- **Codex** (`.codex/`): Optional custom subagents for agent-capable tools.

These are development-process tooling, not application features. Their configuration files should not be modified by OpenWiki documentation runs.
