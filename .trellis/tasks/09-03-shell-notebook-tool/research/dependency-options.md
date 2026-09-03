# Shell Notebook Dependency Research

Date: 2026-09-03

## Code Editor

Registry checks:

- `@uiw/react-codemirror`: `4.25.11`
- `@codemirror/language`: `6.12.4`
- `@codemirror/legacy-modes`: `6.5.4`
- `monaco-editor`: `0.56.0`
- `@codemirror/lang-shell`: not published in the npm registry

Decision:

- Use `@uiw/react-codemirror`.
- Use `StreamLanguage` from `@codemirror/language`.
- Use the Shell mode from `@codemirror/legacy-modes/mode/shell`.
- Do not add Monaco because the feature needs syntax highlighting and editing, not workers, language services, or LSP integration.

## Process Tree Management

Registry check:

- `command-group`: `5.0.1`
- Minimum supported Rust version: `1.68.0`
- API: `CommandGroup::group_spawn()` returns `GroupChild`.
- `GroupChild::kill()` terminates the process group.
- Unix implementation uses a POSIX process group.
- Windows implementation uses a Job Object.

Decision:

- Use `command-group 5.0.1` with its `with-tokio` feature and
  `tokio::process::Command`.
- Keep stdout, stderr, and stdin piped through `AsyncGroupChild::inner()` before
  lifecycle operations begin.
- Use `AsyncGroupChild::kill().await` for Stop, restart, route unmount, and
  application shutdown.
- Do not implement platform-specific process traversal in Shell Notebook.

## Existing Project Facilities

- `src/data/storage.ts` already provides Tauri Store persistence with a browser localStorage fallback.
- `src-tauri/src/proc_env.rs` already derives an augmented login-shell PATH for GUI-launched processes.
- `src/lib/ssh/client.ts` and `src-tauri/src/ssh/session.rs` already demonstrate typed Tauri `Channel` event transport.
- `src/lib/modelConfigIo.ts` demonstrates save-dialog-driven export.
- `src/pages/tools/ToolsPage.tsx` owns sortable utility tab registration and persisted tab order.

These facilities should be reused without coupling Shell Notebook to Agent sandbox or SSH terminal behavior.
