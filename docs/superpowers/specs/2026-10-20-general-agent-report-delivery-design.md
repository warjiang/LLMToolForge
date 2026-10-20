# General Agent Report Delivery Design

Date: 2026-10-20

## Summary

The General Agent currently receives every internal tool, including the HTML
artifact tools. This makes a normal research or summary request capable of
creating a multi-step browser report even when the user only needs a concise
answer.

Add a persistent, session-scoped report delivery setting for the General Agent:

- `chat` (default): return the report as structured Markdown in the chat
  message. Do not expose HTML report-generation tools.
- `html`: expose the existing HTML artifact tools and instruct the General
  Agent to build a previewable HTML report when a report is requested.

The setting is intentionally named `reportDelivery`, not `reportFormat`.
`chat` means rendered Markdown in the conversation, while a future `markdown`
value can mean a separately saved `.md` artifact.

## Goals

- Make chat-rendered Markdown the default report delivery path for General
  Agent sessions.
- Keep the existing rich HTML artifact workflow available by explicit user
  choice.
- Persist the choice with the chat session settings.
- Preserve the existing behavior of DataAgent, ResearchAgent, and saved custom
  agent definitions.
- Keep the implementation frontend-only; do not change the Rust HTML artifact,
  preview, export, or report-link machinery.

## Non-Goals

- Do not create a Markdown file by default.
- Do not add a new Markdown artifact tool in this change.
- Do not infer HTML intent from prompt keywords.
- Do not change existing custom AgentDefinition tool selections.
- Do not modify historical tool-call records or generated artifacts.

## Product Contract

```ts
type ReportDelivery = "chat" | "html";
```

The persisted setting is `ChatSessionSettings.reportDelivery`.

### Chat delivery

- This is the default for new sessions and legacy sessions without the new
  SQLite column.
- The General Agent receives its normal non-report tools, but not
  `data_chart_html`, `data_report_html`, `html_artifact_create`, or
  `html_artifact_block`.
- A concise General Agent system instruction says that reports are returned as
  readable Markdown in the chat and that it must not create a local report
  artifact unless HTML delivery is selected.
- When the user explicitly asks to save a Markdown file, the existing `write`
  tool remains available. This is an explicit file request, not default report
  delivery.

### HTML delivery

- The General Agent receives the existing complete internal tool set, preserving
  the prior General Agent behavior.
- A concise system instruction permits a local previewable HTML artifact where
  appropriate.
- Existing HTML artifact creation, preview registration, live reload, report
  links, and export paths remain unchanged.

### Agent boundaries

- The setting only changes the synthesized General Agent definition.
- ResearchAgent always retains its current HTML research workflow.
- DataAgent retains its current HTML/chart tools.
- Named custom agents retain the exact tools saved in their AgentDefinition.

## Persistence

`report_delivery TEXT NOT NULL DEFAULT 'chat'` is added to
`session_settings`.

The repository migration ensures existing databases receive the column. The row
mapper and browser fallback normalize missing or invalid values to `chat`.
New sessions copy the setting from their current same-agent settings seed, which
matches the existing behavior for model, sandbox, and tool-related settings.

## UI

The General Agent configuration rail gets a compact `Report delivery` select:

- `Chat Markdown`
- `HTML report`

It is rendered only for the General Agent. The select is session scoped and
saves immediately through the existing `updateSettings` path. Changing it
affects the next Agent run; it does not mutate or cancel an in-progress run.

## Runtime Data Flow

```text
Config rail select
  -> useChatStore.saveSettings
  -> ChatRepository session_settings.report_delivery
  -> ChatSessionSettings.reportDelivery
  -> buildAdHocAgentDef
  -> resolveGeneralAgentProfile(reportDelivery)
  -> system instruction + enabled internal tool list
  -> agentRuntimeSignature changes
  -> next General Agent runtime is rebuilt with the selected profile
```

`resolveGeneralAgentProfile` is a pure helper and the single owner of the
delivery-to-tools and delivery-to-instruction mapping.

## Future Markdown Artifact Extension

Do not reserve `markdown` as an alias for chat delivery. A future implementation
can extend the union:

```ts
type ReportDelivery = "chat" | "markdown" | "html";
```

That feature should use a dedicated Markdown artifact contract rather than
pretending the generic `write` tool is a report artifact:

- `markdown_artifact_create` returns title, output path, and artifact directory.
- Optional incremental Markdown blocks support large reports and resumable
  authoring.
- The report-link projection recognizes the Markdown artifact.
- A dedicated preview reuses the existing Markdown renderer and opens the full
  report while the chat bubble shows a compact summary.

This is deliberately deferred: it would add a backend command contract,
artifact projection, preview route, and tests without helping the immediate
goal of keeping ordinary General Agent tasks lightweight.

## Tests

Test-first coverage will include:

1. The profile resolver excludes all four HTML/chart/report tools for `chat`.
2. The profile resolver keeps the prior full tool list for `html`.
3. `chat` and `html` profile instructions preserve the user-provided session
   system prompt.
4. Legacy or invalid stored values normalize to `chat`.
5. Settings persistence and new-session seeding preserve the selected delivery.
6. The General Agent runtime signature changes when delivery changes.

Run the focused Vitest files first, then `pnpm test`, `pnpm exec tsc --noEmit`,
and `pnpm build`.

## Rollback

Removing the General Agent profile resolver and the configuration select restores
the previous all-tools General Agent behavior. The persisted
`report_delivery` column is harmless if left in place, so no destructive SQLite
migration is needed for rollback.
