# Agent Chat Provider Contracts

## Scenario: SQLite Chat With Generated Media

### 1. Scope / Trigger
- Trigger: Agent chat now spans React UI, Zustand state, SQLite persistence,
  provider adapters, and Tauri commands.
- Apply this spec when adding chat message fields, provider generation methods,
  attachment kinds, sandbox commands, or async task polling.

### 2. Signatures
- `ProviderAdapter.chat(req, cred): Promise<ChatResult>`
- `ProviderAdapter.chatStream(req, cred): AsyncGenerator<ChatStreamChunk>`
- `ProviderAdapter.imageGeneration(req, cred): Promise<ImageGenerationResult>`
- `ProviderAdapter.videoGeneration(req, cred): Promise<VideoGenerationResult>`
- `ProviderAdapter.getVideoGenerationTask(req, cred): Promise<VideoGenerationResult>`
- `chatRepo.createMessage(input): Promise<PersistedChatMessage>`
- `chatRepo.appendMessageArtifacts(messageId, { parts, attachments })`
- Tauri command: `run_sandboxed_command({ req })`

### 3. Contracts
- Chat models use `/chat/completions` or `/responses`.
- Image generation models use provider `imageGeneration`; Volcengine Seedream
  uses `POST /images/generations`.
- Video generation models use provider `videoGeneration`; Volcengine Seedance
  uses `POST /contents/generations/tasks`.
- Video task polling uses `GET /contents/generations/tasks/{taskId}` until
  `succeeded`, `failed`, `expired`, or `cancelled`.
- Generated media must be represented as both `message_parts` and `attachments`.
- Attachment kinds are `image`, `audio`, `video`, or `file`.
- Assistant messages must record `connKey`, `provider`, `modelId`, `paramsJson`,
  `raw`, and final `status`.

### 4. Validation & Error Matrix
- Missing connection -> show global Agent chat error, do not persist assistant turn.
- Missing prompt for image/video model -> show global Agent chat error.
- Provider lacks generation method -> assistant error if a turn already exists.
- Task status `failed/expired/cancelled` -> message status `error` with task id.
- Polling transport failure -> message status `error`; preserve task id content.
- Duplicate video URL during polling -> do not append duplicate attachments.

### 5. Good/Base/Bad Cases
- Good: Seedream model is tagged `image-generation` and never sent to chat APIs.
- Good: Seedance model is tagged `video-generation`, creates a task, then appends
  a video attachment to the same assistant message after polling succeeds.
- Base: A task remains `queued/running`; message stays `pending` and content
  shows task id, status, and poll count.
- Bad: Writing a second assistant message for task completion instead of updating
  the existing task message.

### 6. Tests Required
- Build/type check must cover provider type changes.
- Repository CRUD should assert `appendMessageArtifacts` persists parts and
  attachments and restores them in `getSessionBundle`.
- Adapter tests should assert Seedream/Seedance route to generation endpoints,
  not chat endpoints.
- Polling tests should assert success appends one video, terminal failure marks
  message error, and duplicate URLs are ignored.
- Manual desktop test should restart the app and verify pending task messages
  resume polling from persisted `Task ID`.

### 7. Wrong vs Correct

#### Wrong
```typescript
await adapter.chat({ model: seedreamModelId, messages }, cred);
await chat.addMessage({ role: "assistant", content: "done" });
```

#### Correct
```typescript
const result = await adapter.imageGeneration({ model, prompt }, cred);
await chat.addMessage({
  role: "assistant",
  content: "已生成图片。",
  parts,
  attachments,
  provider,
  modelId: model,
});
```

#### Wrong
```typescript
await chat.addMessage({ role: "assistant", content: `Task ID: ${taskId}` });
await chat.addMessage({ role: "assistant", content: "已生成视频。", attachments });
```

#### Correct
```typescript
await chat.updateMessage(messageId, { content: statusText, status: "pending" });
await chat.appendMessageArtifacts(messageId, { parts, attachments });
await chat.updateMessage(messageId, { content: "已生成视频。", status: "complete" });
```

## Scenario: Message Edit / Retry With Linear History

### 1. Scope / Trigger
- Trigger: Agent chat message editing, retry, and deletion span React actions,
  Zustand state, `chatRepository`, SQLite/fallback storage, and provider calls.
- Apply this spec when changing message action UI or truncation persistence.

### 2. Signatures
- `chatRepo.deleteMessagesFrom(sessionId, messageId, includeTarget): Promise<void>`
- `chatRepo.replaceMessageContent(messageId, content, parts?): Promise<PersistedChatMessage>`
- `chatStore.deleteMessagesFrom(sessionId, messageId, includeTarget): Promise<void>`
- `chatStore.replaceMessageContent(messageId, content, parts?): Promise<PersistedChatMessage>`

### 3. Contracts
- Editing a user message updates the target message content and text part, then
  deletes messages after it before generating a new assistant response.
- Retrying a user message deletes messages after that user message, then
  regenerates from the same user message.
- Retrying an assistant message finds the nearest previous user message, deletes
  the assistant message and everything after it, then regenerates from that user.
- Deleting a message deletes the target message and all following messages.
- Truncation must delete message parts, attachments, tool calls linked by
  `messageId`, and sandbox runs linked through those tool calls.

### 4. Validation & Error Matrix
- Empty edited text with no attachments -> show Agent chat error; do not persist.
- Missing connection/model/provider before retry -> show Agent chat error; do not
  truncate history.
- Assistant retry without a previous user message -> show Agent chat error.
- Repository target message not found -> no-op for truncation, error for content
  replacement.

### 5. Good/Base/Bad Cases
- Good: Edit first user turn, later assistant/tool turns disappear, one new
  assistant reply is generated from the edited prompt.
- Base: Delete the latest assistant message; only that message is removed.
- Bad: Delete a middle message while leaving later messages, because provider
  history now contains orphaned context.

### 6. Tests Required
- Build/type check must cover the store/repository signatures.
- Browser fallback test should assert edit/retry/delete survives reload.
- SQLite test should assert truncation removes messages, `message_parts`,
  attachments, linked tool calls, and linked sandbox runs.
- Manual UI test should assert hover actions appear and inline editing does not
  open a modal.

### 7. Wrong vs Correct
#### Wrong
```typescript
await chat.updateMessage(userId, { content: edited });
await chat.addMessage({ role: "assistant", content: next });
```

#### Correct
```typescript
await chat.replaceMessageContent(userId, edited, parts);
await chat.deleteMessagesFrom(sessionId, userId, false);
await generateAssistantFromCurrentHistory(userId);
```

## Scenario: Agent Checkpoint Tool With In-App Approval

### 1. Scope / Trigger
- Trigger: internal agent tools can pause a live Pi agent turn for human
  approval before a protected action.

### 2. Signatures
- `buildInternalTools(enabled, { sandboxMode, workspaceRoot, requestCheckpoint })`
- `requestCheckpoint(request, signal): Promise<CheckpointDecision>`
- Tool request fields: `toolCallId`, `title`, `summary`, `proposedAction`,
  optional `risk`, optional `artifacts`.
- Tool decision fields: `approved`, optional `note`, `decidedAt`.
- Optional session setting: `autoApproveCheckpoints: boolean`, persisted as
  `session_settings.auto_approve_checkpoints` and defaulting to false.

### 3. Contracts
- The `checkpoint` tool must create a `tool_calls` record with status `pending`
  before rendering approval UI.
- ResearchAgent may synthesize a checkpoint from `beforeToolCall` when a model
  directly calls protected tools without an explicit `checkpoint` call.
- Approve resolves the tool with `approved: true`; reject resolves with
  `approved: false` and aborts the current runtime so later tool calls in the
  same batch do not run.
- If `autoApproveCheckpoints` is true, checkpoint requests resolve immediately
  with `approved: true` and an auto-approval note; no approval card is shown or
  awaited, and sandbox permissions are not changed.
- Stop/reset/session rewrite rejects the pending checkpoint and clears the UI.
- Checkpoint suspension is in-memory only; persisted tool calls are audit
  records, not resumable promises after app restart.
- If a model writes pseudo tool syntax such as `<functions.checkpoint ...>` in
  assistant text instead of issuing a real tool call, the app must not display
  the raw function-call blob or treat approval as pending. Runtime/UI text
  sanitization should replace it with a retry notice.

### 4. Validation & Error Matrix
- Missing `requestCheckpoint` -> tool error.
- A second active checkpoint -> tool error.
- Runtime abort while pending -> tool error and no stale approval card.
- User rejection -> successful checkpoint result with `approved: false`, then
  current runtime stops.
- Direct protected ResearchAgent `bash/write/edit/data_*_html` call -> pending
  checkpoint before execution.
- Auto-approval enabled -> no pending card, protected action continues, and the
  checkpoint tool result records the auto-approval note.
- Assistant text contains leaked `<functions.checkpoint ...>` -> no approval is
  considered active; render a retry notice instead of the raw pseudo call.

### 5. Good/Base/Bad Cases
- Good: ResearchAgent asks for approval, user approves, and the same turn
  continues with the protected command.
- Good: A model with no visible reasoning directly calls a protected command;
  runtime pauses before execution and waits for approval.
- Base: User rejects, the checkpoint result is recorded, and no following tool
  calls execute in that turn.
- Base: Model leaks checkpoint syntax as text; user sees a retry notice, not a
  giant JSON blob or a fake pending approval claim.
- Bad: Rendering an approval card without a linked pending `tool_calls` record.
- Bad: Showing raw `<functions.checkpoint ...>` text in a chat bubble.

### 6. Tests Required
- Type/build checks must cover checkpoint request/decision types.
- Manual desktop test should approve, reject, and stop a pending checkpoint.
- Manual desktop test should enable auto-approval, run a protected ResearchAgent
  action, and verify the turn continues without a pending approval card.
- Manual test should verify Direct/DataAgent behavior remains unchanged.

### 7. Wrong vs Correct
#### Wrong
```typescript
await dangerousResearchStep();
await checkpoint();
```

#### Correct
```typescript
const decision = await checkpoint({ title, summary, proposedAction });
if (!decision.approved) return;
await dangerousResearchStep();
```

## Scenario: Session Agent Selector Placement

### 1. Scope / Trigger
- Trigger: built-in and custom agent modes are selected per chat session.

### 2. Signatures
- Session field: `ChatSession.agentId?: string | null`.
- Store action: `chatStore.setSessionAgent(sessionId, agentId)`.
- Built-in values: `null`/`DIRECT_AGENT_VALUE`, `DATA_AGENT_ID`,
  `RESEARCH_AGENT_ID`.

### 3. Contracts
- The session agent selector lives in the sidebar header, next to the app logo,
  and acts as an agent partition filter for the session list.
- The composer must not render a second agent selector.
- The session list must not duplicate agent type badges; list rows show title,
  timestamp, and row actions only.
- Switching the sidebar selector shows only sessions whose stored `agentId`
  matches that agent type. Existing conversation `agentId` values are not
  mutated by the selector.
- If the selected agent partition has no session, the sidebar creates a new
  session for that `agentId`. The new-session button also inherits the selected
  partition's `agentId`.
- `AgentChatView` should derive the active agent from the active session record
  so switching partitions updates the runtime through normal session selection.
- Drag/reorder/group operations in a filtered partition must preserve hidden
  sessions from other agent partitions in the persisted ordering/assignment
  stores.

### 4. Validation & Error Matrix
- Empty partition + selector change -> a new session is created with the
  selected `agent_id`, then selected.
- Partition with existing sessions + selector change -> the newest matching
  session is selected.
- Existing sessions with `agentId: null` -> sidebar shows the default direct
  chat label.
- Reordering filtered sessions -> other agent partitions keep their existing
  assignments/order instead of being dropped from the store.

### 5. Good/Base/Bad Cases
- Good: User picks ResearchAgent in the sidebar header and sees only
  ResearchAgent sessions; composer stays focused on model/tools/sandbox
  controls.
- Base: Old DataAgent/ResearchAgent sessions load without row badges but still
  run with their stored `agentId`.
- Bad: Showing one agent selector in the sidebar and another in the composer
  with potentially divergent state.
- Bad: Treating the sidebar selector as an edit control that rewrites the active
  conversation's `agentId` after that conversation already exists.

### 6. Tests Required
- Type/build checks cover selector state flow and removed composer picker.
- Manual UI test should switch agent partitions, verify each partition shows its
  own sessions, verify new sessions inherit the current partition, and verify
  session rows no longer show agent badges.

### 7. Wrong vs Correct
#### Wrong
```tsx
<ComposerToolbar>
  <AgentSelect />
</ComposerToolbar>
<SessionRow badge="ResearchAgent" />
```

#### Correct
```tsx
<SidebarHeader>
  <AgentPartitionSelect value={agentFilterValue} />
</SidebarHeader>
<SessionList sessions={sessions.filter(matchesAgentPartition)} />
```

## Scenario: ResearchAgent HTML Deliverables

### 1. Scope / Trigger
- Trigger: `ResearchAgent` needs browser-previewable research pages while
  keeping the existing DataAgent local HTML artifact pipeline.

### 2. Signatures
- Internal tools: `data_chart_html`, `data_report_html`.
- `data_chart_html` response must include `outputDir`, `outputPath`, `title`.
- `data_report_html` response must include `outputDir`, `outputPath`, `title`.
- Artifact preview: `dataArtifact(toolName, resultJson)` recognizes those two
  tool names and opens `outputDir`.

### 3. Contracts
- `ResearchAgent` uses `data_chart_html` for interactive ECharts charts and
  `data_report_html` for multi-section report pages.
- These tools are generated-artifact tools and require checkpoint approval, or
  auto-approval when the session setting is explicitly enabled.
- Research pages must be evidence-backed; final conclusions require audit-clean
  evidence first.
- Prefer explicit output paths under the session project root, such as
  `analysis/<scenario>/web-report` or `research-artifacts/<scenario>/report`,
  rather than relying on the `dataagent-artifacts` default directory.
- Do not create a separate TypeScript reporting pipeline for ResearchAgent.

### 4. Validation & Error Matrix
- Sandbox mode blocks writing the requested output path -> tool error.
- Missing audit-clean evidence for final conclusions -> do not generate a final
  conclusions page.
- Direct `data_chart_html` / `data_report_html` call without explicit checkpoint
  -> ResearchAgent runtime guard synthesizes a checkpoint first.

### 5. Good/Base/Bad Cases
- Good: After audit approval, ResearchAgent calls `data_report_html` with
  section text that cites local evidence artifacts and opens the result preview.
- Base: A planning-only page request first asks for approval before generating a
  draft HTML artifact.
- Bad: ResearchAgent writes raw HTML/React files by hand to bypass the built-in
  artifact tools.

### 6. Tests Required
- Type/build checks must cover ResearchAgent prompt and tool definitions.
- Manual desktop test should generate a ResearchAgent HTML report and verify the
  browser preview opens the artifact.
- Manual test should verify Direct/DataAgent behavior remains unchanged.

### 7. Wrong vs Correct
#### Wrong
```typescript
await write({ path: "report.html", content: handcraftedHtml });
```

#### Correct
```typescript
const decision = await checkpoint({ title, summary, proposedAction });
if (!decision.approved) return;
await data_report_html({ title, sections, outputPath });
```

## Scenario: HTML Report Links On Final Summaries

### 1. Scope / Trigger
- Trigger: an agent turn generates an HTML report through one or more tool calls
  and later emits a final text summary.

### 2. Signatures
- `summaryReportArtifactsByMessage(messages, toolCalls): Map<string, SummaryReportArtifact[]>`
- `SummaryReportArtifact` contains `kind: "browser"`, `dir`, optional `file`,
  and optional `title`.

### 3. Contracts
- Derive report links from persisted messages and successful tool-call results;
  do not persist temporary localhost preview URLs.
- Supported report tools are `html_artifact_create`, `html_artifact_block`,
  `data_report_html`, and `write` when its result path is an HTML file.
- A report belongs to the user turn containing its tool-call anchor message.
- Render links only on the last complete assistant text message that occurs
  after the turn's final report tool anchor.
- Deduplicate repeated block updates by artifact directory plus optional file.
- Opening a summary report must reuse the existing preview registration path so
  links continue to work after reopening a historical session.

### 4. Validation & Error Matrix
- Failed tool call -> no report link.
- Missing `outputDir` / HTML path -> no report link.
- Report tool has no later complete assistant text -> no report link.
- Multiple successful calls for the same artifact path -> one report link.
- Multiple distinct artifact paths in one turn -> one link per report.

### 5. Good/Base/Bad Cases
- Good: several `html_artifact_block` calls produce one "Open report" entry on
  the final summary, and reopening history reconstructs the same entry.
- Base: a turn generates two reports and the summary shows two entries.
- Bad: attach the link to a pre-tool "generating report" message or embed the
  preview server's temporary localhost URL in Markdown.

### 6. Tests Required
- Unit tests cover cross-message turn association, path deduplication, multiple
  reports, failed/non-report tools, historical turns, and no post-tool summary.
- Component test asserts the visible report title and that "Open report"
  invokes the callback with the selected artifact.
- Full type-check and production build must pass.

### 7. Wrong vs Correct
#### Wrong
```typescript
summary += `[Open report](${previewStore.url})`;
```

#### Correct
```typescript
const reports = summaryReportArtifactsByMessage(messages, toolCalls);
<SummaryReportLinks reports={reports.get(summary.id) ?? []} onOpen={openArtifactPreview} />;
```

## Scenario: Tool-Call Goals In Agent Timeline

### 1. Scope / Trigger
- Trigger: agent tool timelines need a concise human-readable reason for each
  tool call without changing the persisted tool-call model.

### 2. Signatures
- Internal tool schemas may include optional `goal: string`.
- UI helper: `toolCallGoal(argumentsJson?: string): string | null`.
- Persisted storage remains `tool_calls.arguments_json`.

### 3. Contracts
- `goal` is a user-visible readability field, not an execution input.
- Internal tools ignore `goal` when invoking Tauri commands.
- ResearchAgent and DataAgent prompts should ask models to fill `goal` whenever
  the tool schema supports it.
- `ToolCallCard` renders `arguments.goal` inline after the tool name on the
  collapsed card and still preserves the original arguments in the expanded
  details.
- Missing or invalid `goal` is allowed for backward compatibility; old tool-call
  records render unchanged.
- MCP and skill tools may also display a goal if their serialized arguments
  include a top-level `goal` string.

### 4. Validation & Error Matrix
- `arguments_json` is invalid JSON -> no goal rendered, card remains usable.
- `goal` is empty or non-string -> no goal rendered.
- Very long `goal` -> truncate on one line and avoid horizontal overflow.

### 5. Good/Base/Bad Cases
- Good: `read` call shows "读取 audit.md 以确认是否存在阻断性缺失来源问题".
- Base: older `read` call without `goal` still shows only the tool name.
- Bad: storing goal in a separate column or using it to change tool execution.

### 6. Tests Required
- Type/build checks must cover optional schema fields and JSX rendering.
- Manual desktop test should run a ResearchAgent turn and verify collapsed tool
  cards show goals for new internal tool calls.

### 7. Wrong vs Correct
#### Wrong
```typescript
await chat.recordToolCall({ title: goal, argumentsJson: "{}" });
```

#### Correct
```typescript
await chat.recordToolCall({
  title: toolName,
  argumentsJson: JSON.stringify({ goal, ...toolArgs }),
});
```

## Scenario: Gateway Stream Failures And Chat Error Surfacing

### 1. Scope / Trigger
- Trigger: in-app agent LLM calls stream from the local Portkey gateway sidecar
  over `http://127.0.0.1:<port>/v1` through the `gatewayFetch.ts` plugin-http
  shim; an upstream stream can break after the gateway already sent `200
  text/event-stream`.
- Apply this spec when changing the gateway streaming paths
  (`instrumentResponse`, the Anthropic `/v1/messages` translator loop), the
  sidecar logging sink, or the chat error normalization in `AgentChatView.tsx`.

### 2. Signatures
- `openAIStreamErrorFrames(message): string[]` / `anthropicStreamErrorFrames(message): string[]`
  in `sidecar/gateway/wrapper/gateway.ts`.
- `streamErrorBody(seen, error): string` (annotates the empty-body case).
- `classifyAgentError(raw: string): string | null` in `src/pages/agent/agentError.ts`.
- `normalizeAgentErrorMessage(raw, translate, classifyGatewayErrors)` applies
  gateway classification only when the runtime uses the Unified gateway.
- `formatGatewayDiagnostic(args)` / `streamLogStatus(upstreamStatus, outcome)`
  in `sidecar/gateway/wrapper/observability.ts`.
- `emitCallLog(rec)` / `emitDiagnostic(message)` / `initDiskLog(configPath)` in
  `sidecar/gateway/wrapper/logging.ts`.

### 3. Contracts
- A streaming path that broke mid-flight must enqueue a structured SSE error
  terminator before closing: OpenAI streams emit `data: {"error":{...}}` then
  `data: [DONE]`; Anthropic streams emit an `event: error` frame then the normal
  `message_delta`/`message_stop` close. Never tear the stream down silently — a
  torn stream surfaces to the client as Tauri's opaque `The resource id <n> is
  invalid.` Portkey's inner stream transform must abort its writer on read
  failure so the wrapper can observe and translate the error.
- A failed stream must `finishLog` with status `502` and the seen upstream body;
  when nothing was received, persist an annotated placeholder so the record is
  not dropped as empty.
- A client/downstream cancellation must be logged as status `499`, never `502`,
  so it is distinguishable from an upstream failure.
- `classifyAgentError` maps the known failure family — Tauri `resource id <n> is
  invalid`, `socket connection was closed unexpectedly` / closed-connection, and
  `Failed to parse JSON` — to a stable i18n key; unrelated errors return `null`
  so the raw text still shows. It is a pure, `t`-free function (unit-tested);
  `normalizeAgentErrorMessage` resolves the key via i18n for built-in Pi
  runtimes. External AAP agent errors remain verbatim because the same text can
  describe the child process or AAP transport.
- The sidecar's on-disk log is default-quiet: `emitCallLog` writes to
  `logs/gateway-YYYYMMDD.jsonl` only when `status >= 400` or `error != null`,
  unless `GATEWAY_LOG_ALL=1`. The log dir is derived from the config file's
  directory (no new sidecar arg). Bodies are omitted from this compact log (the
  Rust supervisor already persists full bodies to `unified-bodies/`).
- Portkey's `console.error`/`console.warn` diagnostics (`retryRequest`,
  `tryTargetsRecursively`) are mirrored into the same JSONL as `level: "warn"`
  records so a break correlates with its cause; stderr forwarding is preserved.
  Persistent capture uses an explicit diagnostic-prefix allowlist, retains only
  `Error` summaries, redacts credential-shaped values, and never serializes raw
  chunks, headers, response objects, or arbitrary console arguments.
- Diagnostic strings are capped at 4096 characters. Daily JSONL files rotate at
  1 MB with one backup and are retained for 14 days.
- All disk logging is best-effort and must never throw into a request path.

### 4. Validation & Error Matrix
- Upstream stream breaks after 200 -> SSE error frame emitted, client shows a
  readable localized message, call logged at 502 with the seen body.
- Client closes a stream -> call logged at 499, not as an upstream 502.
- External AAP runtime emits `connection closed` / `Failed to parse JSON` -> raw
  message is preserved instead of being rewritten as a Unified gateway error.
- Pre-routing client error (unknown model, bad JSON, auth) -> returned as a JSON
  error Response before `finishLog`; no `call` record is written.
- Unknown/unmatched raw error string -> `classifyAgentError` returns `null`; the
  chat shows the raw message unchanged.
- Disk write fails -> swallowed; stdout call-log and the request are unaffected.

### 5. Good/Base/Bad Cases
- Good: DeepSeek/new-api stream drops mid-token; chat shows "上游模型连接中断…请
  稍后重试", and `logs/gateway-YYYYMMDD.jsonl` holds the 502 call plus the
  preceding `retryRequest`/`Failed to parse JSON` warn lines.
- Base: a healthy stream completes; nothing is written to disk under the default
  quiet rule.
- Bad: catching the stream error and only closing the controller (client sees
  `resource id is invalid`), or logging every successful call to disk by default.

### 6. Tests Required
- Unit tests for `classifyAgentError`: each recognized pattern maps to its key,
  case-insensitive, and unrelated/empty strings return `null`.
- Bun tests must cover inner stream failure propagation, safe diagnostic
  formatting, stream outcome status mapping, retention cleanup, and size
  rotation.
- New test files must be added to the `vitest.config.ts` `include` allowlist.
- `pnpm build` and `pnpm test` must pass; sidecar changes require
  `pnpm run sidecar:gateway:build` since `tauri dev` runs the compiled binary.

### 7. Wrong vs Correct
#### Wrong
```typescript
} catch (e) {
  done((e as Error).message); // client sees a torn stream → "resource id is invalid"
  controller.close();
}
```

#### Correct
```typescript
} catch (e) {
  const msg = (e as Error).message;
  for (const frame of openAIStreamErrorFrames(msg))
    controller.enqueue(new TextEncoder().encode(frame));
  done('upstream_error', msg); // finishLog at 502 with the seen body
  controller.close();
}
```

## Scenario: Prompt Library Composer Application

### 1. Scope / Trigger
- Trigger: a reusable plain-text Prompt is created, synchronized, selected in
  the Agent composer, or used to derive a first-message session title.

### 2. Signatures
- `PromptTemplate extends BaseEntity`
- `applyPromptTemplate(template, { text, selectionStart, selectionEnd })`
- `usePromptStore = createCollectionStore(promptTemplateRepo)`
- `reloadSyncedData(): Promise<void>`
- `chat.addMessage({ ..., titleHint?: string })`

### 3. Contracts
- `promptTemplateRepo.storeKey` is `promptTemplates`; it must be registered in
  both `syncRegistry` and `syncedCollectionStores`. The first enables encrypted
  resource and snapshot handling; the second refreshes the visible collection
  after sync or restore.
- Prompt content is always expanded into the visible composer before send. It
  never becomes an Agent system prompt, runtime argument, or protocol field.
- Empty or whitespace-only composer text replaces the composer. A non-empty
  composer fills every `{{input}}` placeholder, or inserts a placeholder-free
  template at the current selection.
- Recent Prompt IDs are process-local MRU state only. They are never persisted,
  synchronized, or used to update a Prompt's `updatedAt`.
- `titleHint` is transient. `chat.addMessage` must remove it before
  `chatRepo.createMessage`; it affects only the first session title.

### 4. Validation & Error Matrix
- Missing name or content -> field validation error; editor remains open.
- Source URL is non-empty but not HTTP/HTTPS -> field validation error.
- Prompt collection load fails -> picker/manager show a localized error while
  normal message composition remains usable.
- Snapshot write fails -> preserve the successful primary resource sync under
  the existing best-effort snapshot behavior.
- Prompt definition is edited or deleted after application -> retry uses the
  already persisted expanded message text.

### 5. Good/Base/Bad Cases
- Good: applying `Review {{input}}` to `Explain this` persists
  `Review Explain this`, while the first session title is `Explain this`.
- Base: applying a placeholder-free Prompt to an empty composer places the
  caret at the end and leaves title derivation unchanged.
- Bad: registering a new collection only in `syncRegistry`, which makes sync
  succeed while an open picker keeps stale records.

### 6. Tests Required
- Unit-test Prompt normalization, each application rule, Unicode selection
  offsets, and title-hint fallback.
- Test MRU cap/deduplication and prove it writes neither repository updates nor
  local persistence.
- Test registry membership, reload participation, merge/tombstone behavior, and
  Prompt payload inclusion in successful snapshots.
- Component-test search scope, manager save/delete behavior, picker keyboard
  behavior, error/loading states, and composer selection restoration.
- Add every Prompt test file to `vitest.config.ts` `test.include`.

### 7. Wrong vs Correct
#### Wrong
```typescript
syncRegistry.push({ id: repo.storeKey, labelKey: "sync_res_prompts", repo });
```

#### Correct
```typescript
syncRegistry.push({ id: repo.storeKey, labelKey: "sync_res_prompts", repo });
const syncedCollectionStores = [...existingStores, usePromptStore];
```

## Scenario: Agent Composer Adaptive Sizing

### 1. Scope / Trigger
- Trigger: Agent composer content, viewport dimensions, pane width, attachment
  layout, or toolbar wrapping changes the textarea's required height.

### 2. Signatures
- `useComposerAutoResize({ textareaRef, value, expanded }): void`
- Compact height: `clamp(30vh, 52px, 240px)`
- Focused target: `clamp(55vh, 240px, 560px)`

### 3. Contracts
- Empty and one-line input stays at `52px`; compact input grows with content
  until its cap, then scrolls internally.
- Focused mode keeps the complete composer footer visible. If the target height
  would cross the Agent pane boundary, textarea height yields to the toolbar.
- Recalculate after controlled value changes, focus-mode changes, window
  resizing, and observed Agent-pane/composer-footer geometry changes.
- Internal layout changes such as config/preview rail resizing, attachments, or
  toolbar wrapping must not depend on a `window.resize` event.
- Expanding or collapsing keeps textarea focus. Sending and changing sessions
  restore compact mode.

### 4. Validation & Error Matrix
- Content below compact cap -> no internal scrollbar.
- Content above compact cap -> stable cap with internal scrolling.
- Focused target fits pane -> use viewport-derived focused height.
- Focused footer would overflow -> subtract measured overflow, never below
  `52px`.
- `ResizeObserver` unavailable -> value/focus/window resize behavior still
  works.

### 5. Good/Base/Bad Cases
- Good: opening the config rail narrows the composer; wrapped content is
  remeasured without resizing the window.
- Base: a one-line prompt remains compact and the toolbar does not move.
- Bad: setting only `max-height` without updating textarea height, or observing
  only the window while internal panels resize.

### 6. Tests Required
- Unit-test compact minimum/growth/cap, focused clamping, footer boundary
  fitting, collapse, window resize, and `ResizeObserver` recalculation.
- Preserve Prompt application focus/selection tests.
- Browser-check narrow and desktop viewports for overlap and toolbar visibility.

### 7. Wrong vs Correct
#### Wrong
```typescript
<Textarea className="h-[52px] max-h-32 resize-none" />
```

#### Correct
```typescript
useComposerAutoResize({ textareaRef, value: input, expanded });
```
