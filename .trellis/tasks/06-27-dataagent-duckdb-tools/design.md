# DataAgent With DuckDB Tools Design

## Architecture

- Frontend keeps agent orchestration in `AgentChatView` and builds an in-memory DataAgent definition when the built-in picker value is selected.
- `ChatSessionSettings` gains `workspacePath`, persisted in SQLite and browser fallback storage.
- Internal agent tools remain defined in `src/lib/agent/tools/internal.ts`; new data tools call Tauri commands and return Pi Agent text results with structured details.
- Tauri adds a `data_tools` module that owns path validation, SQL safety checks, DuckDB execution, and HTML artifact writing.

## Data Flow

- User selects DataAgent and sends a message.
- `resolveTurnAgent` returns a built-in `AgentDefinition` with the current session's model/settings plus DataAgent prompt and tool ids.
- `resolveAgent` builds internal tools from that definition.
- DuckDB tools invoke Tauri commands with `workspaceRoot`, `sandboxMode`, sources, SQL, and optional artifact output paths.
- Tauri validates paths and SQL, registers local files as DuckDB views/tables, executes read-only queries, and returns previews or artifact metadata.

## Tool Contracts

- `duckdb_query`: accepts `sources`, `sql`, optional `limit`; returns columns, rows, row count, truncated flag, duration, and normalized sources.
- `data_chart_html`: accepts `sources`, `sql`, `chartType`, `x`, `y`, optional `series`, `title`, `outputPath`; writes self-contained SVG-based HTML and returns path plus row/column summary.
- `data_report_html`: accepts `title`, `sections`, optional `outputPath`; writes self-contained HTML with escaped Markdown-ish text, tables, links to local artifacts, and inline snippets.

## Compatibility

- Existing user-created agents continue to load from `agentDefinitions` unchanged.
- Existing direct chat behavior stays unchanged unless DataAgent is selected.
- Existing sessions get `workspacePath: ""` through migration/default parsing.
