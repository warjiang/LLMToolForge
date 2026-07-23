---
type: System
title: Agent Runtime
description: LLMToolForge agent runtime system — Pi-based in-WebView agents, external subprocess agents via the AAP (Agent Adapter Protocol), tool system with sandboxed execution, and image input support.
tags: [agent, pi, aap, protocol, tools, sandbox, subprocess]
---

# Agent Runtime

LLMToolForge supports two agent runtime paths that converge on the same `AgentRuntime` interface, making them render identically in the chat UI:

1. **Pi Runtime** (in-WebView): Uses [`@earendil-works/pi-agent-core`](https://github.com/earendil-works/pi) for tool-calling agent loops directly in the browser WebView.
2. **External Runtime** (subprocess): Spawns a Python or Node subprocess that speaks the AAP protocol over stdio, with the Tauri host bridging tool calls and forwarding output.

Both runtimes are defined in [`/src/lib/agent/`](/src/lib/agent/) and communicate with the [Unified API gateway](/openwiki/providers/overview.md) for model access, with tool execution handled by the [Rust host](/openwiki/architecture/overview.md).

## Entry Points

| File | Purpose |
|---|---|
| [`/src/lib/agent/runtime.ts`](/src/lib/agent/runtime.ts) | `createAgentRuntime()` — factory that selects Pi or External based on platform and agent definition |
| [`/src/lib/agent/externalRuntime.ts`](/src/lib/agent/externalRuntime.ts) | `createExternalAgentRuntime()` — spawns Python/Node subprocess, bridges AAP events |
| [`/src/lib/agent/agentDefinition.ts`](/src/lib/agent/agentDefinition.ts) | `AgentDefinition` type — reusable config (system prompt, model, tools, skills, MCP, sandbox) |
| [`/src/lib/agent/images.ts`](/src/lib/agent/images.ts) | Image attachment handling for agent chat (recent: PR #66) |
| [`/src/pages/agent/AgentChatView.tsx`](/src/pages/agent/AgentChatView.tsx) | Main chat UI (~200KB) — message rendering, tool status, streaming, image paste/preview |

## AAP Protocol (Agent Adapter Protocol)

The AAP is the wire protocol between the Tauri host and external agent subprocesses. It is framework-neutral and versioned.

**Source of truth**: [`/src/lib/agent/aap/protocol.ts`](/src/lib/agent/aap/protocol.ts) (TypeScript)  
**Cross-language spec**: [`/src/lib/agent/aap/PROTOCOL.md`](/src/lib/agent/aap/PROTOCOL.md)

### Transport

Newline-delimited JSON over the subprocess's standard streams:
- **Host → Agent**: JSON objects to the child's **stdin**
- **Agent → Host**: JSON objects to **stdout**, prefixed with `@@AAP@@`. Lines without the marker are treated as diagnostic logging and forwarded to the host's stderr.

### Message Types

| Direction | Message | Description |
|---|---|---|
| Host → Agent | `init` | Sent first. Contains model config (base URL, local key, model name), system prompt, conversation history, and advertised host tools. |
| Host → Agent | `prompt` | User turn input. In v2, includes optional `images` array for vision-capable models (base64, mimeType). |
| Host → Agent | `abort` | Cooperative cancel of the in-flight turn. |
| Agent → Host | `assistant_start` | Beginning of an assistant response. |
| Agent → Host | `assistant_delta` | Streaming text chunk. |
| Agent → Host | `tool_call` | Agent requests execution of a host tool. |
| Agent → Host | `tool_result` | Host tool execution result (host → agent → host echo). |
| Agent → Host | `done` | Turn complete. |
| Agent → Host | `error` | Turn failed with error. |

### Protocol Versions

- **v1**: Baseline (text-only prompts).
- **v2** (current): Adds optional `prompt.images` field for native multimodal input. Backward compatible — v1 agents ignore the unknown field. The host only sends it when the resolved model is vision-capable.

### Host Tools in AAP

The `init` message advertises **host tools** to the agent. These are app-provided tools the agent can call back into the host via `tool_call`. Each tool's `parameters` is a JSON Schema object. Host tools execute under the app's sandbox and approval mechanism.

## Tool System

Agent tools are defined in [`/src/lib/agent/tools/`](/src/lib/agent/tools/). Each tool category has a dedicated file:

| File | Tool Category |
|---|---|
| [`internal.ts`](/src/lib/agent/tools/internal.ts) | Built-in tools for agent use |
| [`mcp.ts`](/src/lib/agent/tools/mcp.ts) | Wraps enabled [MCP server](/openwiki/integrations/overview.md) tools as agent tools (calls through `mcp_inspect` / `mcp_call_tool`) |
| [`connector.ts`](/src/lib/agent/tools/connector.ts) | 4 discovery tools for [Connectors](/openwiki/integrations/overview.md): `connector_list_apps`, `connector_search_actions`, `connector_get_action_guide`, `connector_execute_action` |
| [`shared.ts`](/src/lib/agent/tools/shared.ts) | Shared tool utilities and abort handling |
| [`skills.ts`](/src/lib/agent/tools/skills.ts) | `load_skill` tool for Pi-style [Skills](/openwiki/integrations/overview.md) content injection |

### Internal Tools

The agent has access to bash and filesystem tools, all gated by sandbox mode:

- **`bash`**: Run shell commands (Rust implementation, `/src-tauri/src/lib.rs` `run_sandboxed_command`)
- **`read` / `write` / `edit`**: Filesystem operations (Rust implementation, `/src-tauri/src/fs_tools/`)
- **`ls` / `grep`**: Directory listing and content search (Rust implementation)

### Sandbox Modes

The sandbox controls what the agent's tools can do, selected per `AgentDefinition`:

| Mode | macOS Backend | Behavior |
|---|---|---|
| `read-only` | Seatbelt profile | No writes allowed |
| `workspace-write` | Seatbelt profile | Read + write within workspace directory |
| `danger-full-access` | Process boundary only | Full filesystem access |

On non-macOS platforms, sandbox protection uses process-boundary isolation instead of Seatbelt.

## External Agent Platform

External agents are built using the platform SDKs in [`/platform/`](/platform/). The Tauri host manages their lifecycle:

1. **Install**: `agent_build_env` creates an isolated environment (Python: `uv venv` + `uv pip install -e .`; Node: `pnpm install`)
2. **Spawn**: `agent_spawn` launches the subprocess, connecting stdin/stdout
3. **Communicate**: `agent_send` writes AAP messages to stdin; stdout lines are parsed for `@@AAP@@`-prefixed events
4. **Kill**: `agent_kill` terminates the subprocess

The Rust supervisor lives in [`/src-tauri/src/agent_host/`](/src-tauri/src/agent_host/):
- [`mod.rs`](/src-tauri/src/agent_host/mod.rs): Subprocess management, AAP event dispatch
- [`install.rs`](/src-tauri/src/agent_host/install.rs): Isolated environment provisioning

Agent packages use an `agent.json` manifest:

```json
{
  "id": "my-agent",
  "name": "My Agent",
  "description": "…",
  "runtime": "python",
  "entry": "main.py",
  "framework": "langgraph",
  "defaults": { "model": "", "temperature": 0.7, "maxTokens": 4096, "systemPrompt": "" }
}
```

See [/openwiki/development/overview.md](/openwiki/development/overview.md) for the platform SDKs and examples.

## Image Support (Recent: PR #66, #65)

The agent runtime recently gained native image input support:

1. **Vision model detection**: [`/src/lib/providers/capabilities.ts`](/src/lib/providers/capabilities.ts) `isVisionModel()` uses a conservative name-based heuristic to detect vision-capable models, including for manual/gateway connections where capability metadata isn't available.
2. **Image paste + preview**: Users can paste images into the chat input (`AgentChatView.tsx`). Pasted images display as clickable thumbnails with aspect-aware sizing (PR #65).
3. **Native image delivery**: When the resolved model is vision-capable, images are sent natively via AAP v2's `prompt.images` field (base64 without `data:` prefix, with MIME type). Non-vision models receive images as file-path references in the text input instead.
4. **Media artifact preview**: Agent-generated images and media are displayed inline with zoomable viewer and "open in system" button (PR #60).

## AgentDefinition

Reusable agent configurations are stored as `AgentDefinition` objects, persisted via the repository layer. Each definition specifies:

- System prompt, model, temperature, max tokens
- Enabled internal tools
- Enabled skills (injected via `<available_skills>` in system prompt)
- Enabled MCP servers (tools wrapped as agent tools)
- Connector tools toggle (on/off)
- Sandbox mode

In the chat UI, the user selects a definition from a dropdown in the input bar. A minimal CRUD management page is built into the agent page.
