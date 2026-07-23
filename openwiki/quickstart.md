---
type: Application
title: LLMToolForge
description: A Tauri 2 desktop application for unified LLM tool management — API keys, provider configuration, agent chat, local Unified API gateway, MCP servers, third-party connectors, skills marketplace, SSH terminals, and encrypted storage sync.
resource: https://github.com/warjiang/LLMToolForge
tags: [tauri, llm, agent, mcp, desktop, rust, react, typescript]
---

# LLMToolForge

LLMToolForge is a desktop application that centralizes LLM tool management. It connects to multiple model providers (Volcengine, OpenAI-compatible gateways, LiteLLM), exposes them through a local Unified API gateway, powers an agent runtime with tool execution and MCP integration, and manages Skills, Connectors, SSH hosts, and encrypted data sync — all from a single desktop app built on Tauri 2.

## What It Does

- **Provider Hub**: Configure Volcengine (AK/SK), New API, LiteLLM, or manual API keys. Models are auto-discovered with capability detection (vision, function-call, image-gen, video-gen).
- **Unified API Gateway**: A local HTTP server exposing all connected models through OpenAI- and Anthropic-compatible endpoints. Use your models with Codex, Claude Code, or any OpenAI SDK — no per-tool API key config.
- **Agent Chat**: Full agent runtime powered by [`pi`](https://github.com/earendil-works/pi) (in-WebView) or external subprocess agents (Python/Node via AAP protocol). Supports multi-turn tool loops, streaming, MCP tools, connector actions, skills, and sandboxed execution.
- **MCP Servers**: Manage, import, and inspect MCP servers (stdio/SSE/HTTP). Built-in servers available with one-click install. Inspector lets you browse tools, call them, and read resources.
- **Connectors**: OpenConnector sidecar providing access to 1,000+ third-party platforms with credential isolation. Agent can discover and execute actions through 4 discovery tools.
- **Skills**: Create, install from GitHub or [skills.sh](https://skills.sh), sync to agent targets. Multi-file skills with update detection via content hashing.
- **SSH**: Host management with credential vault, PTY terminal sessions, ~/.ssh/config import, and host cloning.
- **Storage Sync**: AES-256-GCM encrypted sync to S3-compatible storage with per-resource tombstone merging and versioned history snapshots.
- **Built-in Utilities**: JSON viewer (with React Flow diagram), Base64/URL/Unicode encode-decode, hash tools, text editor, markdown preview, translator.

## Where to Start

| I want to understand… | Go to |
|---|---|
| System architecture and tech stack | [/openwiki/architecture/overview.md](/openwiki/architecture/overview.md) |
| How agents work (Pi runtime, AAP protocol, tools) | [/openwiki/agent/overview.md](/openwiki/agent/overview.md) |
| Provider configuration and the Unified API gateway | [/openwiki/providers/overview.md](/openwiki/providers/overview.md) |
| MCP, Connectors, and Skills integrations | [/openwiki/integrations/overview.md](/openwiki/integrations/overview.md) |
| Storage sync, SSH, sandbox, tray, and cross-cutting infrastructure | [/openwiki/infrastructure/overview.md](/openwiki/infrastructure/overview.md) |
| Building, testing, CI, and external agent SDKs | [/openwiki/development/overview.md](/openwiki/development/overview.md) |

## Quick Reference

**Tech Stack**: Tauri 2 (Rust + React 19) · TypeScript · Vite · Tailwind CSS (Geist design system) · Zustand · shadcn/ui

**Key dependencies**:
- Frontend: `@earendil-works/pi-agent-core` + `pi-ai` (agent runtime), `reactflow` + `dagre` (JSON diagram), `react-router-dom` v7
- Rust: `tauri` v2, `duckdb`, `russh` (SSH), `aws-sdk-s3` (sync), `aes-gcm` + `argon2` (encryption)

**Key files**:
- Frontend routes: [`/src/App.tsx`](/src/App.tsx)
- Rust command surface: [`/src-tauri/src/lib.rs`](/src-tauri/src/lib.rs) (50+ Tauri commands)
- Agent protocol spec: [`/src/lib/agent/aap/PROTOCOL.md`](/src/lib/agent/aap/PROTOCOL.md)
- Unified API bridge: [`/src/lib/unifiedApi.ts`](/src/lib/unifiedApi.ts)

**Development quick start**:
```bash
pnpm install
pnpm dev                  # browser-only (data in localStorage)
pnpm run sidecar:build    # build gateway + connector binaries
pnpm tauri:dev            # full desktop app
```

## Backlog

The following areas are not yet fully documented in the wiki. They are tracked here for future documentation runs.

| Area | Source Anchor | Reason Deferred |
|---|---|---|
| JSON Diagram visualization | `/src/pages/tools/diagram/`, `/src/pages/tools/nodes/`, `/src/pages/tools/edges/` | Large feature area; documented in root `QUICK_START.md`; low architectural coupling to other domains |
| Browser tool (child webview) | `/src-tauri/src/browser.rs`, `/src/pages/browser/` | Standalone utility; straightforward implementation |
| In-app text editor, translator, hash/escape tools | `/src/pages/tools/` (various) | Standalone utilities; pure frontend with no Rust backend |
| Agent Marketplace | `/src/lib/agentMarket/` | Early-stage; GitHub-based agent discovery |
| Updater | `/src-tauri/` (tauri-plugin-updater), `/src/lib/useUpdater.ts` | Standard Tauri updater plugin; minimal custom logic |
