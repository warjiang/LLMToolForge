# Manual Acceptance

Date: 2026-09-03

## Automated Evidence

- `pnpm test`: 25 test files and 145 tests passed.
- `pnpm build`: TypeScript checking and Vite production build passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 48 tests passed.
- `cargo check --manifest-path src-tauri/Cargo.toml`: passed.
- Rust integration tests cover persistent variables, functions, aliases, `cd`,
  completion-frame parsing, `set -e` termination, and long-running command
  Stop/restart behavior.

## Tauri Dev Attempt

- Started `pnpm tauri dev`; Tauri compiled and launched with the local Vite
  server at `http://127.0.0.1:1420/`.
- Browser automation confirmed the Shell Notebook browser-mode limitation.
- A desktop runtime bug was identified and fixed: Rust IPC event fields had
  snake_case names while the frontend expects camelCase, leaving cells queued
  and preventing the UI from reflecting cancellation or restart.

## Desktop Checklist

- [ ] Run a long command and verify streaming output appears without timeout.
- [ ] Verify variables, `cd`, functions, aliases, and shell options persist
      across cells; restart returns to the configured start directory.
- [ ] Verify Stop kills the command and its child processes, then resets state.
- [ ] Run `set -e`, then a failing command; verify `session-lost` is shown and
      Restart creates a usable clean session.
- [ ] Verify Run All stops after the first non-zero exit status.
- [ ] Verify output above 2 MiB is flagged as truncated without hanging Bash.
- [ ] Verify changing the start directory asks for confirmation after execution.
- [ ] Verify Markdown export only includes non-empty shell fences.
