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
