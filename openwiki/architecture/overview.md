---
type: Architecture
title: System Architecture
description: High-level architecture of LLMToolForge — Tauri 2 desktop shell with Rust backend, React frontend, and managed sidecar binaries for the Unified API gateway and OpenConnector.
tags: [architecture, tauri, rust, sidecar, data-flow]
---

# System Architecture

LLMToolForge is a **Tauri 2 desktop application** with a **Rust backend** and a **React 19 + TypeScript frontend** running in a WebView. Two managed sidecar binaries (Portkey gateway and OpenConnector) run as child processes supervised by the Rust layer.

## High-Level Diagram

```
┌────────────────────────────────────────────────────────┐
│  Tauri 2 Desktop Shell                                  │
│                                                         │
│  ┌──────────────────────┐   ┌────────────────────────┐ │
│  │  React Frontend       │   │  Rust Backend           │ │
│  │  (WebView)            │◄──┤  (src-tauri/src/)       │ │
│  │                       │   │                         │ │
│  │  src/pages/           │   │  lib.rs (50+ commands)  │ │
│  │  src/lib/             │   │  agent_host/            │ │
│  │  src/store/ (zustand) │   │  unified/               │ │
│  │  src/data/ (sync)     │   │  connector/             │ │
│  │                       │   │  mcp/                   │ │
│  │                       │   │  ssh/                   │ │
│  │                       │   │  storage/               │ │
│  │                       │   │  data_tools/            │ │
│  │                       │   │  fs_tools/              │ │
│  │                       │   │  tray.rs                │ │
│  └──────────────────────┘   └──────────┬─────────────┘ │
│                                        │                │
│                          ┌─────────────┼─────────────┐ │
│                          │  Sidecar Binaries          │ │
│                          │                            │ │
│                          │  Portkey Gateway :4141     │ │
│                          │  OpenConnector   :4160     │ │
│                          └────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

## Layer Breakdown

### Rust Backend (`src-tauri/src/`)

The Rust layer is the **application backend**, registering 50+ Tauri commands callable from the frontend via `invoke()`. It manages the [Unified API gateway](/openwiki/providers/overview.md), [agent host](/openwiki/agent/overview.md), [MCP inspection and SSH](/openwiki/integrations/overview.md), [storage sync and sandbox](/openwiki/infrastructure/overview.md), and more:

| Module | Responsibility | Key Commands |
|---|---|---|
| `lib.rs` | App builder, sandbox execution, skill sync, attachments | `run_sandboxed_command`, `sync_skills_to_targets`, `save_chat_attachment` |
| `unified/` | Portkey gateway lifecycle + call monitoring | `unified_api_start`, `unified_api_stop`, `unified_api_stats`, `unified_api_push_routing` |
| `connector/` | OpenConnector sidecar lifecycle | `connector_start`, `connector_stop`, `connector_status`, `connector_open_console` |
| `agent_host/` | External agent subprocess supervisor (Python/Node) | `agent_spawn`, `agent_send`, `agent_kill`, `agent_build_env` |
| `mcp/` | MCP Inspector (stdio/SSE/HTTP client) | `mcp_connect`, `mcp_list_tools`, `mcp_call_tool`, `mcp_read_resource` |
| `ssh/` | SSH host management + PTY sessions | `ssh_connect`, `ssh_write`, `ssh_resize`, `ssh_disconnect` |
| `storage/` | Encrypted S3 sync | `storage_push`, `storage_pull`, `storage_configure` |
| `data_tools/` | DuckDB queries + ECharts reports | `duckdb_query`, `data_chart_html`, `data_report_html` |
| `fs_tools/` | Sandboxed filesystem tools | `fs_read`, `fs_write`, `fs_edit`, `fs_list`, `fs_grep` |
| `tray.rs` | System tray with stats + sidecar controls | (background task, no direct frontend invoke) |
| `browser.rs` | Child webview in-app browser | `browser_create`, `browser_navigate`, `browser_bounds`, etc. |
| `preview.rs` | Local static HTTP server for agent artifacts | (internal, no direct invoke) |
| `web_fetch.rs` | HTTP page fetcher (headless) | `web_fetch` |
| `web_fetch_render.rs` | JS-rendered page fetch via native webview | (internal, used by web_fetch) |
| `web_search.rs` | DuckDuckGo scraper | `web_search` |
| `proc_env.rs` | Login-shell PATH recovery | (internal, caches PATH for npx/uvx resolution) |
| `config_io.rs` | Config import/export, text file open | `model_config_export`, `model_config_import`, `text_file_open` |

### React Frontend (`src/`)

The frontend follows a **page-centric architecture** with shared libraries and stores:

```
src/
├── App.tsx              # Route definitions (react-router-dom v7)
├── pages/               # Feature pages (lazy-loaded)
│   ├── providers/       # Provider configuration (Volcengine, gateways, manual keys)
│   ├── agent/           # Agent chat interface (largest component, ~200KB)
│   ├── unified/         # Unified API dashboard + monitoring
│   ├── mcp/             # MCP server management + inspector
│   ├── connectors/      # Connector sidecar management
│   ├── skills/          # Skills CRUD + marketplace
│   ├── ssh/             # SSH host management + terminal
│   ├── tools/           # Utility tools (JSON, Base64, URL, hash, etc.)
│   ├── settings/        # Settings (theme, sync, etc.)
│   └── browser/         # In-app browser wrapper
├── lib/                 # Core libraries
│   ├── agent/           # Agent runtime (Pi + external), AAP protocol, tools
│   ├── providers/       # Provider implementations (volcengine, openai-compatible)
│   ├── unifiedApi.ts    # Frontend bridge for Unified API server
│   ├── mcp/             # MCP configurations
│   ├── connector/       # Connector API client
│   ├── skillMarket/     # Skill marketplace (GitHub + skills.sh)
│   └── ssh/             # SSH client
├── store/               # Zustand stores (unified, chat, connector, ssh, sync, theme, etc.)
├── data/                # Storage abstraction with repository pattern + sync registry
├── components/          # Shared UI (layout, ui/, common/)
└── types/               # TypeScript type definitions
```

### Sidecar Binaries

Two external binaries run as child processes, built with [Bun](https://bun.sh) and supervised by the Rust layer:

1. **Portkey Gateway** (`sidecar/gateway/`, port 4141): A local HTTP server that routes model requests to upstream providers. Exposes OpenAI-compatible (`/v1/chat/completions`, `/v1/models`) and Anthropic-compatible (`/v1/messages`) endpoints. The Rust layer pushes routing tables (model → upstream mapping) and collects call logs.

2. **OpenConnector** (`sidecar/connector/`, port 4160): An OAuth gateway for 1,000+ third-party providers. Credentials are stored in its own SQLite database, isolated from the app's data store. The Rust layer manages its lifecycle and generates an admin token for the frontend to communicate with it.

Both are **opt-in**: the gateway must be started manually from the Unified API page, and the connector from the Connectors page (or system tray).

## Data Flow

### Provider → Agent Chat Flow
```
User configures provider → Frontend stores in tauri-plugin-store
   → When Unified API starts → Frontend pushes routing table to Rust
   → Rust configures Portkey gateway sidecar
   → Agent chat sends requests to http://127.0.0.1:4141/v1
   → Gateway routes to upstream provider using stored credentials
```

### Agent Tool Execution Flow
```
User prompt in AgentChatView →
  Pi agent runtime (in-WebView) or External agent (subprocess via AAP) →
    LLM call through Unified gateway →
    Tool call (bash, fs, MCP, connector) →
      Rust command execution (sandboxed for bash/fs) or
      MCP/Connector sidecar call →
    Result returned to agent → Next turn or final response
```

### External Agent Flow (AAP Protocol)
```
AgentChatView creates ExternalAgentRuntime →
  Rust spawns Python/Node subprocess →
  AAP init message via stdin (model config, history, host tools) →
  Subprocess calls Unified gateway for LLM →
  Tool calls bridged back to host via AAP →
  Streaming output via stdout (@@AAP@@ prefix) →
  Frontend renders identically to Pi agent output
```

## Persistence

- **Desktop (Tauri)**: `tauri-plugin-store` writes JSON files to the app data directory
- **Browser (dev mode)**: Automatically falls back to `localStorage`
- **Abstraction layer**: `src/data/storage.ts` and `src/data/repository.ts` unify storage access
- **Sync**: `src/data/sync/registry.ts` defines which resources participate in encrypted S3 sync

## Frontend Routing

All routes are defined in [`/src/App.tsx`](/src/App.tsx) with lazy loading:

| Path | Page | Component |
|---|---|---|
| `/` | Dashboard | `DashboardPage` |
| `/providers` | Provider management | `ProvidersPage` |
| `/agent` | Agent chat | `AgentChatView` (via DashboardPage redirect currently) |
| `/unified` | Unified API | `UnifiedApiPage` |
| `/skills` | Skills | `SkillsPage` |
| `/mcp` | MCP servers | `McpPage` |
| `/connectors` | Connectors | `ConnectorsPage` |
| `/ssh` | SSH | `SshPage` |
| `/tools` | Utilities | `ToolsPage` |
| `/browser` | Browser | `BrowserPage` |
| `/settings` | Settings | `SettingsPage` |

## Key Architectural Decisions

1. **Sidecar over embedded**: The gateway and connector run as separate binaries rather than being embedded in Rust. This keeps the Tauri binary lean and allows the sidecars to be built with Bun/TypeScript independently.

2. **AAP over framework coupling**: External agents communicate via a framework-neutral stdio protocol (AAP) rather than being tightly coupled to a specific agent framework. This lets users build agents in Python (LangChain) or Node (Vercel AI SDK) without the app knowing about those frameworks.

3. **Credential isolation for connectors**: Third-party credentials (API keys, OAuth tokens) are stored exclusively in the connector's own SQLite database. They are never written to the app's data store or included in sync, maintaining a strong security boundary.

4. **Heuristic vision detection**: For manual/gateway connections where model capabilities aren't provided by the provider's API, the app uses a conservative name-based heuristic (`isVisionModel` in `/src/lib/providers/capabilities.ts`) to detect vision-capable models. This enables image input for manual connections without requiring users to configure capabilities.

5. **Login-shell PATH recovery**: The app queries the user's login shell for its real `PATH` at startup (`/src-tauri/src/proc_env.rs`), caching it in a `OnceLock`. This is critical for resolving `npx`, `uvx`, `pnpm` when the app is launched from Finder/Dock (which doesn't inherit shell PATH).
