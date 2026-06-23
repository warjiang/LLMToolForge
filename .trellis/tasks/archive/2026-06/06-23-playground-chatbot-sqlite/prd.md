# Refactor Playground Chatbot with SQLite

## Goal

Refactor the existing Playground from a single in-memory prompt tester into a
persistent multi-session chatbot workspace for testing models, multimodal
inputs, MCP tools, Skills, and sandboxed script execution.

## Requirements

- Support multiple persisted chat sessions with create, select, rename, delete,
  and restart-safe history.
- Support multi-turn chat history, system prompt, model parameters, connection
  selection, and per-session default model settings.
- Persist Playground chat data in SQLite via the Tauri v2 SQL plugin. SQLite is
  the source of truth for sessions, messages, parts, attachments, tool calls,
  sandbox runs, and session settings.
- Keep existing provider, MCP, and Skill configuration stores compatible for
  this task; add a clear migration boundary so those records can move to SQLite
  later.
- Support multimodal input for text, images, and files. Store file bytes outside
  SQLite in app data when needed, and persist metadata/path/hash in SQLite.
- Integrate current model switching behavior into the new Playground. Switching
  model or connection affects future assistant turns and is recorded on each
  generated assistant message.
- Support enabled MCP and Skill capabilities in conversations. The first
  implementation may expose deterministic local tool execution and tool records
  while establishing the tool-call loop contract for provider-native tool calls.
- Add a Tauri-side sandbox execution boundary for user Skills/scripts inspired
  by Codex sandboxing. The preferred target is direct integration of
  openai/codex sandbox crates; if the upstream workspace cannot compile as a
  stable dependency, implementation must preserve the same local API boundary
  and document the fallback.
- Present a three-column Playground layout: sessions, conversation composer,
  and model/tools/sandbox configuration.
- Preserve browser development where possible, but live model calls, SQLite, and
  sandbox execution are expected to work in the Tauri desktop app.

## Acceptance Criteria

- [ ] `pnpm build` succeeds.
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` succeeds or any
      upstream Codex dependency blocker is clearly reported with the exact
      failing dependency/API.
- [ ] A fresh app initializes the SQLite database and can create a chat session.
- [ ] Sending multiple messages persists user and assistant turns and restores
      them after a page/app reload.
- [ ] Image and file attachments are represented in persisted message parts and
      render back in chat history.
- [ ] Session default model settings can be changed and are used for subsequent
      sends; assistant messages record the model/connection used.
- [ ] Skill/script execution can be launched through the Playground tool path,
      records stdout/stderr/status/duration, and stores a tool-call record.
- [ ] MCP/Skill selections are visible in the right rail and persisted as part
      of session settings.
- [ ] Deleting a session removes its messages, parts, attachments, tool calls,
      and sandbox run records.

## Notes

- This task is intentionally scoped to Playground chat data. Existing provider,
  MCP, and Skill management pages can continue using the current Store-backed
  repositories.
