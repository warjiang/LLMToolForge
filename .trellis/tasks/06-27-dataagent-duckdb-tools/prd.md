# DataAgent With DuckDB Tools

## Goal

Provide a built-in DataAgent preset that can analyze local data files with DuckDB, create visual HTML charts, and assemble self-contained static HTML reports from the normal chat agent experience.

## Requirements

- DataAgent is an app-provided preset, not a persisted user-created `AgentDefinition`.
- DataAgent reuses the current chat model, enabled skills, enabled MCP servers, sandbox mode, and workspace path.
- DataAgent adds data-focused instructions and the internal tools `duckdb_query`, `data_chart_html`, and `data_report_html` alongside the existing local tools.
- Chat settings include a local `workspacePath`; if empty, data/file tools must fail clearly instead of guessing a workspace.
- DuckDB v1 supports local CSV, TSV, JSON, JSONL, and Parquet files only.
- Data tools enforce sandbox constraints:
  - source files must be inside `workspacePath` unless sandbox mode is `danger-full-access`
  - chart/report writes are denied in `read-only`
  - `workspace-write` can write only under the workspace or temp directory
  - SQL is read-only and single-statement, accepting only `SELECT` or `WITH`
- Chart and report artifacts are self-contained HTML files that do not require network/CDN access.
- Tool results include useful previews, row/column metadata, output paths, and errors that the agent can act on.

## Acceptance Criteria

- [x] The agent picker includes a built-in DataAgent option.
- [x] Selecting DataAgent and setting a workspace enables DuckDB query, chart HTML, and report HTML tools.
- [x] Empty workspace paths produce a clear tool error.
- [x] Local CSV/TSV/JSON/JSONL/Parquet files can be queried through DuckDB.
- [x] Unsafe SQL and out-of-scope paths are rejected.
- [x] Chart/report HTML files are generated under allowed output paths and escape user/data content safely.
- [x] `cargo test` or `cargo check` passes for `src-tauri`.
- [x] `pnpm build` passes.
