# Implementation Plan

1. Add SQLite plugin dependencies and Tauri plugin registration/capabilities.
2. Implement `chatRepository` with migrations, CRUD, and browser fallback.
3. Implement `chatStore` for sessions, messages, settings, attachments, and
   tool/sandbox records.
4. Extend shared types for chat persistence, multimodal message parts, tool
   calls, and sandbox runs.
5. Add Tauri sandbox command with stable request/response DTOs.
6. Refactor `PlaygroundPage` into three-column persisted chat UI while reusing
   existing provider/model selection logic.
7. Add Skill/script execution affordance and persist execution results.
8. Extend provider types for tool-call-compatible metadata without breaking
   existing adapters.
9. Validate with `pnpm build` and `cargo check --manifest-path src-tauri/Cargo.toml`.

## Risk Points

- The openai/codex workspace may not be directly consumable as a small git
  dependency. If so, keep the command boundary and ship a conservative native
  process sandbox fallback with the blocker documented.
- Tauri SQL availability differs from browser dev mode; repository code must
  isolate this cleanly.
- Large attachments should not be stored as unbounded SQLite blobs in this task.
