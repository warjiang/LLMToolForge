# Prompt Library and Quick Apply Design

Date: 2026-08-18
Status: Ready for review

## 1. Summary

Add a local Prompt library to the Agent composer so users can collect, manage,
search, and quickly apply reusable prompts.

The first release uses an explicit, one-shot model:

1. The user writes a question or selects a Prompt first.
2. Selecting a Prompt applies one of the three visible rules in Section 6:
   replace an empty composer, fill `{{input}}` from an existing draft, or insert
   a placeholder-free template at the caret.
3. The inserted text remains visible and editable, and the user can keep typing
   or add attachments where the model supports them.
4. Sending uses the existing message and Agent runtime paths without hidden
   prompt injection.

This feature is a message-authoring aid. It is not a new Agent type, Skill
protocol, system prompt layer, or persistent conversation mode.

## 2. Motivation

LLMToolForge already supports:

- Agent definitions for persistent personas, models, tools, Skills, and MCP
  configuration.
- Skills for reusable capabilities that an Agent can load on demand.
- Session system prompts for persistent conversation-level instructions.
- Starter prompts that fill the composer on the empty welcome screen.

It does not provide a personal library for reusable thinking methods or
task-specific prompt templates. Users must currently keep those prompts
elsewhere and paste them manually. A reusable Prompt is best modeled as an
authoring aid for the current user message, not as permanent Agent behavior.

## 3. Goals

- Let users create, edit, delete, favorite, tag, search, and apply Prompts.
- Make applying a Prompt fast from the existing Agent composer.
- Keep the exact text sent to the model visible and editable.
- Support both workflows:
  - Write a question, then apply a Prompt.
  - Select a Prompt, then continue typing or fill an optional placeholder.
- Insert an applied Prompt at the composer caret and preserve surrounding text
  by default, so `{{input}}` is optional rather than required.
- Keep applying a Prompt available on any model, including multimodal and
  image/video-generation models; a plain-text Prompt body composes with the
  composer's existing attachment support.
- Work identically for direct chat, the built-in Pi Agent, and external Agents.
- Store Prompts locally using the existing repository abstraction.
- Back up Prompt records to the configured S3 or S3-compatible object storage
  through the existing encrypted data-sync system.
- Merge and reuse the same Prompt collection across multiple terminals.
- Include Prompt records in immutable encrypted history snapshots so a previous
  collection can be restored.
- Keep template expansion in a pure, independently tested function.

## 4. Non-goals

The first release will not include:

- A public Prompt marketplace or community ratings.
- Automatic extraction of Prompts from web pages.
- AI rewriting, scoring, or optimizing a saved Prompt.
- Prompt version history.
- Prompt chains or workflow orchestration.
- Arbitrary form generation for multiple template variables.
- Automatically applying a Prompt to every turn in a session.
- Hidden system/developer-message injection.
- Automatic conversion between Prompts, Agents, and Skills.
- A separate Prompt cloud account, backend service, or synchronization
  credential.
- Automatic or scheduled synchronization. Prompt backup follows the existing
  manual data-sync trigger.
- Real-time collaborative Prompt editing.
- Built-in or pre-seeded Prompt records. The first release starts with an empty
  library and avoids seed markers, special IDs, and resurrection handling.

## 5. Product Model

### 5.1 Concept boundaries

| Concept | Scope | Purpose |
|---|---|---|
| Prompt template | One composed user message | Reuse a thinking method or task instruction |
| Agent definition | Multiple sessions and turns | Configure persistent behavior, model, tools, Skills, MCP, and sandbox |
| Skill | Loaded capability | Provide reusable instructions and optional tool usage |
| Session system prompt | Entire session | Apply persistent conversation-level instructions |

The UI should call the new concept "Prompts". It must not present Prompts as a
lighter form of Agent or Skill.

### 5.2 Prompt record

```ts
interface PromptTemplate extends BaseEntity {
  name: string;
  description: string;
  content: string;
  tags: string[];
  sourceUrl?: string;
  favorite: boolean;
}
```

Rules:

- `name` is required after trimming.
- `content` is required after trimming.
- `description` is a short explanation of when to use the Prompt.
- Tags are normalized by trimming, removing empty values, and removing
  case-insensitive duplicates.
- `sourceUrl` is optional. When present, it must be an HTTP or HTTPS URL.
- `favorite` controls the pinned section in the picker.

The persisted collection uses the existing `Repository<T>` and collection
store patterns. Its store key also becomes its data-sync resource ID.

In the first release, recent-use ordering is an application-process-level MRU
list of at most five Prompt IDs. Selecting an existing ID moves it to the front;
deleted IDs are filtered when the list is projected to records; favorites are
excluded from the recent section to avoid duplicate rows. The list is not a
field on the synced Prompt entity and is not persisted to disk. Applying a
Prompt therefore does not bump its `updatedAt` timestamp and cannot participate
in any sync conflict. Recent order resets when the app restarts; favorites and
search cover durable discovery. Persisting recent use across restarts is
deferred (Section 14).

## 6. Template Syntax

The first release recognizes one optional reserved token:

```text
{{input}}
```

No other template language is introduced. `{{input}}` is not required. A Prompt
with no placeholder is fully supported and is the common case.

Applying a Prompt normally inserts the template at the composer caret and
preserves the surrounding text, so it feels like the natural "type and augment"
behavior of a text field and requires no template syntax. The behavior is
determined by two observable facts only — whether the composer is empty, and
whether the template contains `{{input}}` — never by a hidden caret condition
the user cannot perceive.

A composer is empty when `text.trim().length === 0`; an empty string and a
whitespace-only string therefore follow Rule 1. The original whitespace-only
value is replaced by the template rather than retained.

Expansion is deterministic and follows three rules:

### Rule 1 — Empty or whitespace-only composer

- Insert the template body as the whole composer value.
- If the template contains `{{input}}`, focus the composer and select the first
  occurrence so the user's next keystroke replaces it.
- If it has no placeholder, place the caret at the end.

### Rule 2 — Non-empty composer, template contains `{{input}}`

This preserves the "write the question first, then wrap it in a framework"
workflow, where the framing may precede the user's question.

- Replace every `{{input}}` occurrence with the current composer text.
- Use the result as the whole composer value and place the caret at the end.

This rule is intentionally independent of caret position: the moment a
placeholder template is applied on top of existing text, the existing text is
what fills `{{input}}`. Inserting a placeholder template as inert text in the
middle of other text is not a supported case in the first release. This is the
only non-empty rule that replaces the entire composer; the original text is not
discarded because it is copied into every placeholder.

### Rule 3 — Non-empty composer, template has no `{{input}}`

- Insert the template body at the current caret position (replacing any active
  selection), preserving the text before and after it.
- Place the caret at the end of the inserted body.

Template expansion never runs during send. Applying a Prompt is the only
operation that expands it. After expansion, the composer contains ordinary text
and the user may edit it freely, including adding attachments where the model
supports them (see Section 7.1).

## 7. User Experience

### 7.1 Composer entry

Add a Prompt library icon button to the right side of the composer toolbar,
next to the existing Skills and MCP controls.

The button:

- Uses a familiar library/book icon.
- Has a tooltip such as "Prompts".
- Opens a lightweight picker popover.
- Is available for every model type, including image- and video-generation
  models. A Prompt body is plain text inserted into the composer; it does not
  depend on the model's output modality.

The first-release scope limits the Prompt **body** to plain text, not the model
it can be used with. After a Prompt is inserted, the composer's existing
attachment and image-input capabilities keep working independently, so on a
multimodal model the user can add images or more text alongside the inserted
Prompt text exactly as they would with any hand-typed message. Supporting
non-text content **inside** a stored Prompt template is a separate future
extension (see Non-goals) and is unrelated to enabling the button.

### 7.2 Prompt picker

The picker contains:

- A search input focused when the picker opens.
- Compact sections for favorites and recently used Prompts.
- A filtered result list.
- Prompt name, short description, and up to two tags per row.
- A "Manage Prompts" command at the bottom.

When the search input is empty, the picker shows the favorites and recent
sections (empty sections are not rendered). As soon as the query is non-empty,
those sections collapse into a single filtered result list so the popover stays
short and shallow. Filtered results use deterministic ordering: favorites
first, then Prompt name in locale-aware ascending order.

Search matches name, description, and tags without case sensitivity. The first
release does not match Prompt body content, because a body-only hit would show a
row with no visible reason for matching. Full-content search is deferred until
the picker can show a matching snippet (Section 14).

Selecting a row:

1. Reads the current composer text and caret/selection position.
2. Expands the selected template according to Section 6.
3. Updates the composer with the expanded result.
4. Closes the picker.
5. Focuses the composer and restores the calculated selection or cursor.
6. Updates the application-process MRU without modifying the synced Prompt.

There is no confirmation dialog.

### 7.3 Prompt management

"Manage Prompts" opens a dialog with:

- A searchable Prompt list on the left.
- A focused editor on the right.
- Create, edit, favorite, and delete actions.
- A delete confirmation for every Prompt.

The editor fields are:

- Name.
- Usage description.
- Prompt content.
- Tags.
- Source URL.
- Favorite toggle.

Saving validates required fields and preserves the editor if persistence
fails. The dialog does not provide model execution or Prompt preview in the
first release.

### 7.4 Empty state

The first release ships no built-in Prompt records. A new installation shows an
empty picker with a direct "Manage Prompts" action so the user can create the
first Prompt. This deliberately avoids seed-specific persistence, deletion, and
cross-terminal conflict behavior.

## 8. Architecture

### 8.1 Domain and persistence

Add:

- A `PromptTemplate` type.
- A Prompt repository using the existing generic repository.
- A collection store using `createCollectionStore`.
- **Two separate registrations** so the collection both syncs and refreshes
  after sync/restore (these are independent code sites; missing the second one
  produces the subtle "sync succeeds but the open UI does not refresh" bug):
  1. A `syncRegistry` entry with a localized sync-resource label in
     `src/data/sync/registry.ts`. This wires the sync engine and Settings UI.
  2. Append the Prompt collection store to the hardcoded
     `syncedCollectionStores` array in `src/store/index.ts`. `reloadSyncedData()`
     only iterates that array, so the picker will not refresh after sync or
     restore unless the store is added here.
- A small in-memory recent-usage list scoped to the running application
  process. It is not persisted and is not part of object-storage sync, so no
  extra storage key or sync exclusion is required.

No Rust command or SQLite chat migration is required. Prompt definitions use
the Tauri Store abstraction, with the existing localStorage fallback during
browser development. `AgentChatView` owns initial loading by adding
`usePromptStore.getState().load()` to its existing initialization effect; the
picker renders loading, empty, error, and populated states from that store.

### 8.2 Object-storage backup and multi-terminal sync

Prompt synchronization reuses the existing Settings > Data Storage
configuration and sync actions. It does not add another provider configuration
or a Prompt-specific remote service.

Register the Prompt repository as a normal sync resource (this is the first of
the two registrations noted in Section 8.1; the `reloadSyncedData` registration
is the second):

```text
resource id: promptTemplates
remote object: resources/promptTemplates.json.enc
payload:
  items: PromptTemplate[]
  tombstones: Tombstone[]
```

The Settings sync-resource list shows a localized label such as "Prompt
收藏". Once object storage and an encryption passphrase are configured:

1. A user creates, edits, favorites, or deletes a Prompt on terminal A.
2. The next normal data sync encrypts and uploads the Prompt resource alongside
   the application's other configuration resources.
3. Terminal B points to the same bucket, prefix, and passphrase, then runs
   normal sync.
4. The sync engine decrypts the remote Prompt payload, merges it with terminal
   B's local collection, persists the merged result, and reloads the Prompt
   store.
5. Terminal B can immediately find and apply the synchronized Prompt.

Security and storage behavior are inherited from the existing sync engine:

- Prompt names, descriptions, bodies, tags, source URLs, and favorite state
  are contained only in the encrypted per-resource object and encrypted
  snapshots.
- The plaintext manifest contains resource metadata, hashes, timestamps, and
  the non-secret KDF salt, but no Prompt content.
- The encryption passphrase is not uploaded in plaintext.
- The configured object-store prefix isolates all LLMToolForge objects in the
  same way as existing configuration backup.

Conflict behavior also follows the existing entity merge contract:

- Different Prompt IDs are combined.
- Concurrent edits to the same Prompt use whole-record last-write-wins based on
  `updatedAt`.
- Exact timestamp ties prefer the local record.
- A deletion creates a tombstone; the newest signal between the Prompt and its
  tombstone wins.
- Favoriting is a real Prompt edit and therefore synchronizes.
- Recent usage is in-memory process state and never participates in merge
  conflicts.

Every successfully written whole-archive history snapshot includes the merged
Prompt payload. Snapshot creation remains best-effort: a snapshot write failure
does not turn an otherwise successful primary sync into a failure. Restoring
the latest backup or a selected history snapshot restores both Prompt records
and tombstones. Prompt data that is absent from an older archive is left
untouched under the sync engine's existing absent-resource rule.

After sync or restore, `reloadSyncedData()` must reload the Prompt collection
store with the other registered collection stores so the picker updates
without restarting the application.

### 8.3 Template expansion

Add a pure domain function similar to:

```ts
interface ComposerState {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

interface AppliedPrompt {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  titleHint?: string;
}

function applyPromptTemplate(
  template: PromptTemplate,
  composer: ComposerState
): AppliedPrompt;
```

The function receives the composer text plus the caret/selection. It needs the
caret only for Rule 3 (inserting a placeholder-free template into non-empty
text); Rules 1 and 2 depend only on whether the text is empty and whether the
template contains `{{input}}`. `selectionStart`/`selectionEnd` in the result
describe where the caret or highlighted `{{input}}` should land after applying.

`titleHint` is the trimmed pre-expansion composer text when it is non-empty.
The composer holds this hint as local component state. It is set when a Prompt
is applied, cleared on the first manual composer edit after applying, and
cleared again after `send()`. There is no need to track or compare the previous
expanded text (see Section 8.4).

#### Session-title plumbing

Session titles are not model-generated today. `chat.addMessage` derives the
title purely mechanically from the first user message via
`titleFromFirstMessage` in `src/store/chat.ts`, which trims, collapses
whitespace, and truncates to 28 characters. It runs only for the first user
message of a session.

Because the persisted user-message `content` is the full expanded Prompt, this
default would title every templated session with the Prompt's opening line
(for example "请按以下步骤分析这个问题…"). To keep titles meaningful without
changing the persisted message, thread the optional pre-expansion hint through
the existing first-message title path. This is a cross-cutting change spanning
the composer, the send path, and the chat store, not a change local to
`AgentChatView`:

1. Add an optional `titleHint?: string` field to the `chat.addMessage` input
   type in `src/store/chat.ts`. It is a transient hint only; it is not
   persisted as a message field.
2. In `addMessage`, when `isFirstUserMessage` is true and a non-empty
   `titleHint` is provided, derive the session title from the hint
   (`titleFromFirstMessage(titleHint)`) instead of from `input.content`. All
   other behavior, including persistence of the full expanded `content`, is
   unchanged.
3. `send()` in `AgentChatView.tsx` passes the current `titleHint` when it calls
   `chat.addMessage`, then clears the hint.

The full expanded Prompt remains the persisted user-message content; only the
derived title differs.

If the user selected a Prompt before writing any input, `titleHint` is absent
and the existing first-message truncation remains the fallback. Automatic title
inference from arbitrary Prompt text, and any move to model-generated titles,
are out of scope.

This title refinement is a usability nicety, not a correctness requirement. If
the plumbing above is deferred, the feature still functions: templated sessions
simply fall back to the existing 28-character truncation of the expanded text.

### 8.4 UI components

Keep Prompt-specific UI outside the already large `AgentChatView.tsx`.
Suggested boundaries:

- `PromptPicker`: search, sections, selection, and manage command.
- `PromptManagerDialog`: list/editor orchestration.
- `PromptEditor`: validated Prompt fields.
- `applyPromptTemplate`: pure expansion and selection calculation.

All new labels, empty states, validation messages, errors, tooltips, and
confirmation copy are added to both English and Chinese `pages` locale files;
Prompt UI components do not introduce hard-coded user-facing strings.

`AgentChatView` owns only:

- Opening the picker and manager.
- Passing the current composer value to the picker.
- Applying the returned text and selection into the composer.
- Holding the temporary session-title hint (see Section 8.3) and passing it to
  `send()`.

#### Composer integration details

The composer today is a controlled `<Textarea>` bound to the `input` state with
`value={input}` and `onChange={setInput}`, and it exposes no ref for imperative
selection. Applying a Prompt requires three things the current composer does not
yet expose:

1. Reading the live caret/selection (`selectionStart`/`selectionEnd`) before
   applying, needed only for Rule 3 (Section 6). Add a textarea ref and read the
   selection at apply time.
2. Setting the composer value. `setInput(applied.text)` already covers this.
3. Restoring the calculated `selectionStart`/`selectionEnd` (Section 6). React
   does not restore a controlled textarea's selection from `value` alone, so
   this needs an imperative step. After the value update commits, call
   `setSelectionRange(selectionStart, selectionEnd)` and `focus()` (for example
   in a `useLayoutEffect` keyed on the applied result, or an equivalent
   post-update callback). This is the same mechanism required to highlight an
   inserted `{{input}}` placeholder in Sections 6 and 10.

The Prompt library toolbar entry sits alongside the existing composer controls
(Skills and MCP via `ComposerToolMenu`, the model cascade, attachments, and the
sandbox selector). It is available for every model type (Section 7.1); it is not
gated on model capability.

`titleHint` is transient composer state with a deliberately simple lifecycle:
set it when a Prompt is applied, clear it on the first manual composer edit
after applying (the `onChange` handler clears it), and clear it again inside
`send()` after the message is dispatched. This avoids storing or diffing the
last expanded text. If the user edits and then rewrites the composer entirely,
the worst case is that the session title falls back to the existing
28-character truncation, which is an acceptable fallback (Section 8.3).

### 8.5 Existing send path

The send path remains authoritative:

1. The expanded Prompt is visible in the existing textarea.
2. `send()` reads and trims it as normal.
3. The complete text is persisted as the user message.
4. Direct chat sends it through the provider adapter.
5. Pi and external Agents receive it through their existing `prompt()` methods.
6. Follow-up turns continue normally from persisted conversation history.

No runtime signature, Agent system prompt, AAP protocol, retry protocol, or
message-history format changes are required.

## 9. Data Flow

```text
Prompt repository
  -> Prompt collection store
  -> Prompt picker
  -> applyPromptTemplate(template, composer state)
  -> visible editable composer text
  -> existing send()
  -> persisted user message
  -> direct chat / Pi Agent / external Agent
```

Object-storage synchronization is an independent persistence flow:

```text
Prompt repository + tombstones
  -> existing sync registry
  -> merge local and remote by updatedAt
  -> AES-256-GCM encrypted Prompt resource
  -> S3 / S3-compatible object storage
  -> encrypted whole-archive history snapshot
  -> reload Prompt store on each terminal
```

Editing, retrying, and replaying a sent user message operate on the already
expanded text. They do not need the original Prompt definition, so later edits
or deletion of that definition cannot change conversation history.

## 10. Error Handling

- Repository load failure: show the normal collection error state and keep the
  composer usable without Prompts.
- Invalid save: show field-level errors and do not close the editor.
- Persistence failure: keep all entered editor values and show a concise error.
- Missing Prompt after concurrent deletion: close the picker row action and
  show a non-blocking "Prompt no longer exists" error.
- Sync conflict: use the existing entity `updatedAt` merge and tombstone
  behavior.
- Prompt resource pull, decryption, or parse failure: retain the current local
  Prompt collection and report the existing sync error.
- History-snapshot write failure: preserve the successful primary Prompt sync,
  matching the existing non-fatal snapshot behavior.
- Empty or whitespace-only composer plus a template containing `{{input}}`:
  insertion succeeds; the placeholder remains visibly selected rather than
  sending automatically.

Prompt content is user-controlled text. The application does not execute it,
grant permissions, enable tools, or modify sandbox settings.

## 11. Accessibility and Interaction

- All icon-only actions have tooltips and accessible names.
- Picker rows are keyboard navigable.
- Enter applies the highlighted Prompt.
- Escape closes the picker without modifying the composer.
- Focus returns to the composer after selection.
- The selected `{{input}}` range is visible to keyboard users.
- Dialog fields have labels and validation messages.
- Long names, descriptions, tags, and Prompt content wrap or truncate without
  resizing toolbar controls.

## 12. Testing

`vitest.config.ts` uses an explicit `test.include` allowlist. Every new Prompt
test file must be added to that allowlist in the same change; verification must
confirm the expected Prompt test files and test count appear in `pnpm test`
output.

### Unit tests

Cover the pure expansion function:

- Rule 1: empty and whitespace-only composers insert the body; select the first
  `{{input}}` when present, otherwise place the caret at the end.
- Rule 2: non-empty composer plus a `{{input}}` template replaces every
  `{{input}}` with the existing text, regardless of caret position.
- Rule 2 fires for both a collapsed end-of-text caret and a full selection,
  proving it does not depend on caret position.
- Rule 3: non-empty composer plus a placeholder-free template inserts at the
  caret, preserves the text before and after, and replaces an active selection.
- Returns a trimmed existing draft as `titleHint`.
- Handles multiline and Unicode content without incorrect selection offsets.

Cover normalization and validation:

- Required name and content.
- Tag trimming and case-insensitive deduplication.
- HTTP/HTTPS source URL validation.

### Component tests

- Picker search covers name, description, and tags, and does not match body
  content.
- With an empty query the favorites and recent sections show; a non-empty query
  collapses them into a single list ordered by favorite then Prompt name.
- Recent usage is capped at five IDs, moves repeated selections to the front,
  filters deleted records, and excludes favorites from the recent section.
- Applying a Prompt updates the composer and restores focus/selection.
- Manage dialog preserves values after a failed save.
- Delete requires confirmation.
- The Prompt control is available on image/video-generation and multimodal
  models, and an inserted text Prompt still permits adding attachments.

### Integration tests

- A Prompt-expanded message follows the existing direct-chat send path.
- The same expanded message follows the Agent runtime path.
- The persisted message contains the exact visible composer text.
- Retry uses the persisted expanded text after the source Prompt is edited or
  deleted.
- The first-message title uses the pre-expansion question when available.
- Prompt records and tombstones participate in the sync registry.
- Prompt content is present only in encrypted resource objects and encrypted
  history snapshots, not in the plaintext manifest.
- Terminal A create/edit/favorite followed by sync, then terminal B sync,
  produces the same Prompt record on terminal B.
- Terminal A deletion followed by sync propagates the tombstone to terminal B
  and does not resurrect the Prompt.
- Concurrent edits to different Prompt IDs are preserved.
- Same-ID edits follow the documented `updatedAt` last-write-wins behavior.
- Applying a Prompt updates application-process recent usage only and does not
  alter the synced entity's `updatedAt`.
- Restoring a selected history snapshot restores Prompt records and tombstones,
  then refreshes the open picker without an application restart.

## 13. Acceptance Criteria

- Users can manage a persistent local collection of Prompt templates.
- A new installation starts with an empty library and requires no seed or
  migration behavior.
- Users can find a Prompt by search, favorites, process-local recent usage, or
  tags.
- Selecting a Prompt exposes its full content in the composer.
- An empty or whitespace-only composer is replaced by the template. For a
  non-empty composer, a placeholder template replaces the composer after
  filling every `{{input}}` with the original draft; a placeholder-free
  template inserts at the caret or selection and preserves surrounding text.
- Users can edit the inserted Prompt before sending, and can add attachments
  where the model supports them.
- Both workflows are supported: write a question then apply a Prompt, or apply a
  Prompt then continue typing. `{{input}}` is optional; when present it marks the
  caret landing point in an empty composer and captures existing text when a
  Prompt is applied on top of it (Section 6 rules).
- The Prompt control is available on every model type, including
  image/video-generation and multimodal models.
- Sending requires no hidden Prompt state and uses all existing runtime paths.
- Conversation retry remains stable if a Prompt definition later changes.
- Prompt definitions are backed up as a dedicated encrypted object-storage
  resource through the existing data-sync configuration.
- Prompt records, favorite state, edits, and deletions synchronize across
  terminals that use the same bucket, prefix, and passphrase.
- Each successfully written encrypted history snapshot includes Prompt data;
  snapshot write failure retains the existing non-fatal sync behavior, and
  snapshot restore reloads Prompt data into the picker.
- Prompt bodies and source URLs never appear in the plaintext sync manifest.
- Process-local recent usage is in-memory only and cannot alter or overwrite
  remote Prompt content.
- No Agent definition, Skill protocol, sandbox mode, or AAP protocol behavior
  changes.

## 14. Rollout

Implement as a normal enabled feature rather than a new top-level navigation
page. The composer entry is sufficient for discovery, while management remains
one command away.

If real usage shows that long expanded Prompts make message bubbles difficult
to scan, a later release may add structured Prompt chips and message metadata.
That change must preserve a way to inspect the exact rendered text and must not
retroactively alter existing conversations.

Deferred to a later release, based on observed need:

- Persisting recent-use order across restarts (first release keeps it
  in-memory).
- Full-content search, paired with a matching-snippet preview in picker rows.

---

# 附录 A — 落到本仓库代码的锚点与决策

> 本附录记录方案映射到本项目代码的具体位置与关键取舍，供实现时参考。
> 上文即完整设计方案（原 `docs/superpowers/specs/` 版本已并入此处）。

## 现有可复用抽象（已核对）

- `Repository<T extends BaseEntity>` — `src/data/repository.ts`。
  `storeKey` 即 sync 资源 id；`readAll/replaceAll/listTombstones/replaceTombstones`
  是同步引擎的合并/恢复钩子；`remove()` 写 tombstone。
- `createCollectionStore(repo)` — `src/store/createCollectionStore.ts`。
- `BaseEntity { id; createdAt; updatedAt }` — `src/types/index.ts`。tombstone 是
  独立的 `<storeKey>__tombstones`，不是实体字段。
- 同步引擎 — `src/data/sync/`（registry / engine / tombstones / types / backend）。
  AES-256-GCM、KDF salt、明文 manifest、整档快照、`updatedAt` LWW + tombstone。
- `reloadSyncedData()` — `src/store/index.ts:55`，只遍历硬编码的
  `syncedCollectionStores`（`src/store/index.ts:43`）。
- 输入框 — `src/pages/agent/AgentChatView.tsx`：受控 `<Textarea>`
  （`value={input}`/`onChange={setInput}`，约 L3269），`send()` 约 L2697，
  工具栏 Skills/MCP 用 `ComposerToolMenu`。
- 会话标题 — `src/store/chat.ts`：`titleFromFirstMessage`（L80，纯 28 字截断），
  在 `addMessage` 首条用户消息时调用（L245）。**当前无 LLM 生成标题**。
- Tauri Store + localStorage fallback — `src/data/storage.ts`。

## 关键设计决策

1. **两处注册**（易漏）：`sync/registry.ts` 加条目 + `store/index.ts` 的
   `syncedCollectionStores` 追加 store。缺第二处 → 同步成功但 picker 不刷新。
2. **`{{input}}` 可选，三规则**（§6）：只看“空/非空 + 是否含占位符”，不看光标。
   `applyPromptTemplate` 为纯函数，caret 仅 Rule 3 需要。
3. **不按模型禁用按钮**：正文纯文本与模型输出模态无关；附件是输入框独立能力。
4. **最近使用降级为进程内 MRU**：最多 5 个 ID，不持久化、不进 sync、不改
   `updatedAt`；收藏项不在最近分段重复显示。
5. **不预置 Prompt**：新安装为空库，不引入 seed、marker、特殊 ID 或额外
   Repository API。
6. **titleHint 简化生命周期**：apply 时设，首次手动 onChange 清，send 后再清；
   不 diff 上次展开文本。

## 组件边界（§8.4）

- `applyPromptTemplate`（`src/lib/prompt/`）— 纯展开 + 选区计算。
- `PromptPicker` — 搜索/分段/选用/管理入口。
- `PromptManagerDialog` — 列表 + 编辑器编排。
- `PromptEditor` — 校验字段。
- `AgentChatView` 只负责：开关 picker/manager、传入 composer state、写回
  text+selection、持有并传递 `titleHint`。
