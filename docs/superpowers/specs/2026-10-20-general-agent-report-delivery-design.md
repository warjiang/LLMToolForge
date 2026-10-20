# General Agent Report Delivery Design

Date: 2026-10-20

## Summary

The General Agent (the ad-hoc agent built by `buildAdHocAgentDef` when no agent
is selected) currently receives every internal tool, including the HTML
artifact tools. This makes a normal research or summary request capable of
creating a multi-step browser report even when the user only needs a concise
answer.

Add a session-scoped report delivery setting for the General Agent:

- `chat` (default): return the report as structured Markdown in the chat
  message. Do not expose the HTML report tools.
- `html`: expose the existing HTML artifact tools and instruct the General
  Agent to build a previewable HTML report when a report is requested.

The setting persists with its session, but is never inherited: every new
session starts with `chat`.

The setting is intentionally named `reportDelivery`, not `reportFormat`.
`chat` means rendered Markdown in the conversation, while a future `markdown`
value can mean a separately saved `.md` artifact.

## Goals

- Make chat-rendered Markdown the default report delivery path for every new
  General Agent session.
- Keep the existing rich HTML artifact workflow available by explicit
  per-session choice.
- Persist the choice with that session's settings without propagating it to
  new sessions.
- Keep chat-delivered reports from being cut off by the default 1024-token
  session output limit.
- Preserve the existing behavior of DataAgent, ResearchAgent, and saved custom
  agent definitions.
- Keep the implementation frontend-only; do not change the Rust HTML artifact,
  preview, export, or report-link machinery.

## Non-Goals

- Do not create a Markdown file by default.
- Do not add a new Markdown artifact tool in this change.
- Do not infer HTML intent from prompt keywords in code. Explicit user requests
  for HTML are handled by the chat-delivery instruction, not by switching the
  profile.
- Do not detect length-truncated responses or add a continue-generation UI.
  This is a follow-up if truncation still shows up despite the output floor.
- Do not change existing custom AgentDefinition tool selections.
- Do not modify historical tool-call records or generated artifacts.

## Product Contract

```ts
type ReportDelivery = "chat" | "html";
```

The persisted setting is `ChatSessionSettings.reportDelivery`.

### Chat delivery

- This is the default for every new session and for legacy sessions without
  the new SQLite column. Existing General Agent sessions therefore move from
  the all-tools behavior to `chat` after upgrade; this is intended.
- Tools: the full internal tool list minus `data_report_html`,
  `html_artifact_create`, and `html_artifact_block`.
- `data_chart_html` stays available. It is a single-call chart over local
  tabular data, not a report, and the report-link projection
  (`summaryReportArtifacts.ts`) already does not treat it as one. Chat Markdown
  has no chart rendering (only `react-markdown` + `remark-gfm`), so removing it
  would leave the General Agent unable to chart local data at all. The
  instruction limits it to explicit chart requests.
- Output limit: the effective `maxTokens` is
  `max(Number(settings.maxTokens) || 4096, CHAT_REPORT_MIN_MAX_TOKENS)` with
  `CHAT_REPORT_MIN_MAX_TOKENS = 8192`. The default session value is `"1024"`.
  HTML reports spread content across many `html_artifact_block` calls, but a
  chat report must fit in one assistant message. 8192 matches
  `DEFAULT_MAX_TOKENS` in `src/lib/agent/model.ts`. A larger rail value still
  wins.
- The `write` tool remains available for explicit Markdown file requests and
  ordinary file work, including HTML source files in coding tasks.
- The delivery instruction is appended after the user's session system prompt
  and must cover:
  1. Reports, summaries, and analyses are written in the reply as structured
     Markdown; no local report artifact.
  2. An explicit request for an HTML or previewable report gets the Markdown
     version plus one sentence pointing to the Report delivery setting. The
     model must not hand-write an HTML report with `write` or `bash` as a
     substitute. Coding tasks that ask for HTML source files are unaffected.
  3. Long reports: stay focused; deliver the most important sections first and
     offer to continue.
  4. `data_chart_html` only on an explicit chart request.
  5. `write` for a Markdown file only on an explicit file request.

Draft instruction:

```text
Report delivery: chat.
When the user asks for a report, summary, or analysis, write it directly in your reply as well-structured Markdown (headings, lists, tables). Do not create a local report artifact.
If the user asks for an HTML or previewable report, give the Markdown version and add one sentence saying they can switch "Report delivery" (报告交付方式) to "HTML report" (HTML 报告) in the configuration panel. Do not hand-write an HTML report with write or bash instead. This does not restrict coding tasks where the user asks for HTML source files.
Keep reports focused. If a report would be very long, deliver the most important sections first and offer to continue.
Use data_chart_html only when the user explicitly asks for a chart of local data.
Save a Markdown file with write only when the user explicitly asks for a file.
```

### HTML delivery

- Tools: the full internal tool list, which is the same tool set the General
  Agent has today.
- Output limit: unchanged (`Number(settings.maxTokens) || 4096`).
- A delivery instruction is appended after the user's session system prompt.
  This is the only behavior difference from today, because the General Agent
  currently has no built-in instruction.
- Existing HTML artifact creation, preview registration, live reload, report
  links, and export paths remain unchanged.

Draft instruction:

```text
Report delivery: HTML report.
When the user asks for a report or a polished deliverable page, build a previewable HTML artifact: scaffold it once with html_artifact_create, then add one section at a time with html_artifact_block. Use data_report_html only as a quick fallback.
Answer ordinary questions that are not reports directly in chat.
```

### Agent boundaries

- The setting only changes the General Agent definition
  (`selectedAgentId === null`).
- ResearchAgent always retains its current HTML research workflow.
- DataAgent retains its current HTML/chart tools.
- Named custom agents retain the exact tools saved in their AgentDefinition.
- Sessions of those agents still store the column but ignore it.

## Profile Resolver

New module `src/pages/agent/generalAgentProfile.ts`:

```ts
interface GeneralAgentProfile {
  systemPrompt: string;
  enabledInternalTools: AgentInternalToolId[];
  maxTokens: number;
}

function resolveGeneralAgentProfile(
  settings: Pick<ChatSessionSettings, "system" | "maxTokens" | "reportDelivery">
): GeneralAgentProfile;
```

- Pure function and the single owner of the delivery-to-tools,
  delivery-to-instruction, and delivery-to-output-limit mapping.
- System prompt composition follows `buildDataAgentDef`:
  `[settings.system?.trim(), deliveryInstruction].filter(Boolean).join("\n\n")`.
- `buildAdHocAgentDef` and `ADHOC_AGENT_ID` move into this module.
  `buildAdHocAgentDef` takes `systemPrompt`, `enabledInternalTools`, and
  `maxTokens` from the profile; every other field is unchanged.
- `agentRuntimeSignature` moves unchanged to
  `src/pages/agent/agentRuntimeSignature.ts` so tests can import it without
  loading `AgentChatView.tsx`. It already includes `systemPrompt`,
  `enabledInternalTools`, and `maxTokens`, so a delivery change rebuilds the
  runtime on the next send with no further changes.

## Persistence

`ReportDelivery` and `normalizeReportDelivery(value: unknown): ReportDelivery`
live in `src/types/chat.ts` beside `DEFAULT_CHAT_SETTINGS`, so the data layer
does not import from `pages/`. Missing or invalid values normalize to `chat`.

The column is `report_delivery TEXT NOT NULL DEFAULT 'chat'` on
`session_settings`. All of the following ship in the same change:

| Location | Change |
| --- | --- |
| `src/types/chat.ts` | `ChatSessionSettings.reportDelivery`; `DEFAULT_CHAT_SETTINGS.reportDelivery = "chat"`; type and normalizer |
| `chatRepository.ts` `migrations` | Add the column to `CREATE TABLE session_settings` (new databases) |
| `chatRepository.ts` `ensureColumns` | `ALTER TABLE session_settings ADD COLUMN report_delivery ...` (existing databases) |
| `chatRepository.ts` `rowToSettings` | `normalizeReportDelivery(row.report_delivery)` |
| `chatRepository.ts` `normalizeSettings` | Normalize for the browser fallback |
| `chatRepository.ts` `settingsForNewSession` | Always `reportDelivery: "chat"`; never copied from the seed |
| `chatRepository.ts` `upsertSettings` | INSERT column list, `$17` placeholder, `ON CONFLICT` assignment, parameter array |

`upsertSettings` is raw SQL. TypeScript cannot detect a missing column there,
and Vitest runs under jsdom where `isTauri()` is false, so only the
localStorage fallback is exercised. A miss shows up as the selection reverting
to `chat` after a reload. The manual Tauri check below covers this path.

New sessions: `settingsForNewSession` keeps copying model, sandbox, skills,
MCP, and the other existing fields from the same-agent seed, but always sets
`reportDelivery` to `chat`. HTML delivery is a deliberate per-session opt-in.
Inheriting it would let one opt-in silently become the new default.

## UI

- `ConfigRail` gets an `isGeneralAgent` prop (`selectedAgentId === null`). The
  select renders only when it is true.
- A compact `Report delivery` select sits in the same block as the sandbox
  select and uses the same label-plus-control row layout.
- New i18n keys in `src/i18n/locales/{en,zh}/pages.json`:

| Key | en | zh |
| --- | --- | --- |
| `agent_report_delivery` | Report delivery | 报告交付方式 |
| `agent_report_delivery_chat` | Chat Markdown | 对话内 Markdown |
| `agent_report_delivery_html` | HTML report | HTML 报告 |

- The select saves immediately through the existing `updateSettings` path and
  applies only to the current session.
- Changing it affects the next send. `send` is guarded by `sending`, and the
  runtime is only rebuilt at the next send, so an in-progress run is neither
  mutated nor cancelled.

## Runtime Data Flow

```text
Config rail select
  -> updateSettings -> useChatStore.saveSettings
  -> chatRepo.updateSettings -> session_settings.report_delivery
  -> ChatSessionSettings.reportDelivery
  -> buildAdHocAgentDef
  -> resolveGeneralAgentProfile(settings)
  -> systemPrompt + enabledInternalTools + maxTokens
  -> agentRuntimeSignature changes
  -> next send rebuilds the General Agent runtime with the selected profile
```

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

Write the tests first. `vitest.config.ts` lists test files explicitly, so every
new test file must be added to its `include` array; otherwise `pnpm test`
silently skips it.

`src/pages/agent/tests/general-agent-profile.test.ts`:

1. `chat` excludes `data_report_html`, `html_artifact_create`, and
   `html_artifact_block`, and keeps `data_chart_html`, `write`, and every other
   internal tool.
2. `html` returns exactly `AGENT_INTERNAL_TOOL_IDS`.
3. Both modes put the user system prompt first and the delivery instruction
   after it. An empty user system prompt yields only the instruction.
4. Output limit: `chat` maps `"1024"` to 8192 and keeps `"16000"`; `html` keeps
   `"1024"` and maps `""` to 4096.
5. The `chat` instruction contains the HTML-request redirect and the rule
   against hand-written HTML reports. Assert on stable phrases so a wording
   edit that drops either rule fails.
6. `buildAdHocAgentDef` with `chat` vs `html` produces different
   `agentRuntimeSignature` values; the same delivery produces equal values.

`src/data/tests/chat-report-delivery.test.ts` (browser fallback path):

7. `normalizeReportDelivery` maps `undefined`, `""`, `"markdown"`, and `"HTML"`
   to `chat`, and `"html"` to `html`.
8. Legacy fallback settings without `reportDelivery` read back as `chat`.
9. `updateSettings({ reportDelivery: "html" })` followed by `getSettings`
   returns `html`.
10. `createSession` with a seed whose `reportDelivery` is `html` creates a
    session with `chat`, while the seed's model and sandbox mode are still
    copied.

Do not add these assertions to `src/store/tests/chat-settings-seed.test.ts`:
it uses `console.assert` and is not in the `include` list.

Run the focused Vitest files first, then `pnpm test`, `pnpm exec tsc --noEmit`,
and `pnpm build`.

Manual check in the Tauri app (`pnpm tauri:dev`), which covers the SQLite path:

1. An existing database opens without errors, and an existing General Agent
   session shows `Chat Markdown`.
2. Switch to `HTML report`, restart the app, and confirm it is still selected.
3. In HTML mode, a report request opens an artifact preview. Switch to chat,
   send the same request, and confirm the Markdown answer appears in chat, no
   artifact is created, and the report is not cut off at the default Max
   Tokens of 1024.
4. In chat mode, asking for an "HTML report" returns Markdown plus the
   one-sentence hint, and no `.html` file is written.
5. A new General Agent session created after step 2 shows `Chat Markdown`.
6. DataAgent and ResearchAgent show no select and still produce HTML reports.

## Risks

- Output floor vs. model limits: if an upstream model's maximum output is below
  8192 tokens, a chat-mode request may be rejected. `ExposedModel` carries only
  feature tags and no output-limit metadata, so the floor cannot be clamped per
  model. If this is observed, apply the floor only when the session value is
  the default `"1024"`.
- Instruction compliance: the report tools are removed, so the model cannot
  call them, but avoiding hand-written HTML reports through `write` or `bash`
  relies on the instruction. Manual check 4 covers this.

## Rollback

Removing the General Agent profile resolver and the configuration select
restores the previous all-tools General Agent behavior. The persisted
`report_delivery` column is harmless if left in place, so no destructive SQLite
migration is needed for rollback.
