# Design: SQLite Playground Chatbot

## Architecture

- Add a SQLite-backed chat data layer using the Tauri SQL plugin on desktop and
  a localStorage-backed in-memory-compatible fallback for browser development.
- Keep SQL access behind `src/data/chatRepository.ts`; React components and
  Zustand stores must not issue raw SQL directly.
- Add `src/store/chat.ts` for session/message state and async operations.
- Keep provider credentials, model lists, MCP server config, and Skill config on
  the existing repositories for this task.
- Add a small Tauri command surface for sandbox execution. The front end calls a
  stable `run_sandboxed_command` command and records the result in SQLite.

## Data Model

- `sessions`: title, timestamps, archived flag.
- `session_settings`: connection/model/wire format/system prompt/temperature/
  max tokens/streaming/tool ids/sandbox mode as JSON-friendly columns.
- `messages`: session id, role, status, text content, provider/model metadata,
  usage JSON, raw JSON, error.
- `message_parts`: message id, ordered multimodal parts (`text`, `image`,
  `file`, `tool_result`).
- `attachments`: session/message ids, name, mime, size, data URL or app-data
  path, hash.
- `tool_calls`: session/message ids, source (`mcp` or `skill`), tool name,
  arguments JSON, result JSON/text, status, timing.
- `sandbox_runs`: tool call id, command/args/cwd/env keys, sandbox mode, stdout,
  stderr, exit code, status, timing.

## Runtime Flow

- On page load, initialize migrations, load sessions, select the newest session
  or create one on first send.
- Sending a message persists the user message and parts first, then creates a
  pending assistant message.
- If tool execution is disabled, use the current streaming path where supported.
- If tools are enabled, run a deterministic non-streaming loop: call provider,
  execute requested local tool calls when present, persist tool results, then
  call provider again with tool results until final assistant text or a small
  max-iteration limit.
- For the first implementation, provider-native tool call parsing may be
  limited to OpenAI-compatible response shapes; Skill manual execution remains
  available even when a model/provider does not emit tool calls.

## Sandbox Boundary

- Prefer direct integration with openai/codex sandbox crates in `src-tauri`.
- Keep `run_sandboxed_command` independent from Codex internals so a fallback
  implementation can preserve product behavior if the upstream workspace is not
  consumable as a git dependency.
- Default sandbox mode is `read-only`; `workspace-write` can write only inside
  the current workspace/app sandbox root; `danger-full-access` is not exposed as
  the default.

## Compatibility

- Existing Store data remains untouched.
- Browser mode can show persisted chat via fallback storage, but desktop is the
  source of truth for SQLite, live calls, and sandbox execution.
- SQLite migrations must be idempotent and safe on repeated app startup.
