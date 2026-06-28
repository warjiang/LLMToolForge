# Playground Provider Contracts

## Scenario: SQLite Chat With Generated Media

### 1. Scope / Trigger
- Trigger: Playground chat now spans React UI, Zustand state, SQLite persistence,
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
- Missing connection -> show global Playground error, do not persist assistant turn.
- Missing prompt for image/video model -> show global Playground error.
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
- Trigger: Playground message editing, retry, and deletion span React actions,
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
- Empty edited text with no attachments -> show Playground error; do not persist.
- Missing connection/model/provider before retry -> show Playground error; do not
  truncate history.
- Assistant retry without a previous user message -> show Playground error.
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
