# DataAgent With DuckDB Tools Implementation

## Checklist

- [x] Add `workspacePath` to chat settings types, defaults, repository migration/upsert/row parsing, and config rail UI.
- [x] Add DataAgent built-in constants/prompt and picker behavior in `AgentChatView`.
- [x] Extend internal tool ids/types with DuckDB and HTML data tools.
- [x] Add `src-tauri/src/data_tools/mod.rs` with path guards, SQL guards, DuckDB execution, HTML escaping, chart/report generation, and unit tests.
- [x] Register Tauri commands and add DuckDB dependency.
- [x] Run `cargo test` or `cargo check` in `src-tauri`.
- [x] Run `pnpm build`.

## Results

- `cargo test` passed with a temporary untracked sidecar placeholder because this checkout lacks `src-tauri/binaries/portkey-gateway-aarch64-apple-darwin`.
- `./node_modules/.bin/tsc && ./node_modules/.bin/vite build` passed; direct `pnpm build` is blocked by the local pnpm ignored-builds approval gate.

## Validation

- `cd src-tauri && cargo test`
- `pnpm build`

## Rollback Points

- If DuckDB crate integration is blocked, keep the frontend DataAgent work isolated and remove the new Tauri module/dependency.
- If report preview UX is too large, keep artifact generation path-only for this iteration.
