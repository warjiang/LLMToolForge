# Prompt Library and Quick Apply Design

Date: 2026-08-18
Status: Ready for review

## 1. Summary

Add a local Prompt library to the Agent composer so users can collect, manage,
search, and quickly apply reusable prompts.

The first release uses an explicit, one-shot model:

1. The user writes a question or selects a Prompt first.
2. Selecting a Prompt expands its full text into the composer.
3. The expanded text remains visible and editable.
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
elsewhere and paste them manually.

The motivating article provides a "bidirectional steelman" Prompt that follows
a two-stage conversation:

1. Restate the user's real problem.
2. Strengthen both the supporting and opposing positions.
3. Identify the true disagreement and the variables that could change the
   conclusion.
4. Ask one decisive question.
5. Wait for the user, then give a judgment, reasons, and next actions.

Source:
<https://mp.weixin.qq.com/s/6eDElggMR7aefaEzlWfVMA>

This is best modeled as a reusable template for the current user message. It
should not become a permanent Agent behavior unless the user deliberately
copies it into an Agent definition.

## 3. Goals

- Let users create, edit, delete, favorite, tag, search, and apply Prompts.
- Make applying a Prompt fast from the existing Agent composer.
- Keep the exact text sent to the model visible and editable.
- Support both workflows:
  - Write a question, then apply a Prompt.
  - Select a Prompt, then fill its input placeholder.
- Work identically for direct chat, the built-in Pi Agent, and external Agents.
- Store Prompts locally using the existing repository abstraction.
- Back up Prompt records to the configured S3 or S3-compatible object storage
  through the existing encrypted data-sync system.
- Merge and reuse the same Prompt collection across multiple terminals.
- Include Prompt records in immutable encrypted history snapshots so a previous
  collection can be restored.
- Ship a bidirectional steelman Prompt as the initial curated example.
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

Recent-use timestamps are device-local picker metadata rather than fields on
the synced Prompt entity. Applying a Prompt therefore does not bump its
`updatedAt` timestamp. This prevents routine use on one terminal from winning a
last-write-wins conflict and overwriting a real content edit made on another
terminal.

## 6. Template Syntax

The first release recognizes one reserved token:

```text
{{input}}
```

No other template language is introduced.

Expansion is deterministic:

### Existing composer text is non-empty

- If the template contains `{{input}}`, replace every occurrence with the
  current composer text.
- If the template does not contain `{{input}}`, produce:

```text
<template content>

<current composer text>
```

### Existing composer text is empty

- Insert the template unchanged.
- If `{{input}}` exists, focus the composer and select the first occurrence so
  the user's next keystroke replaces it.
- If no placeholder exists, put the cursor at the end.

Template expansion never runs during send. Selection is the only operation
that expands a Prompt. After expansion, the composer contains ordinary text
and the user may edit it freely.

## 7. User Experience

### 7.1 Composer entry

Add a Prompt library icon button to the right side of the composer toolbar,
next to the existing Skills and MCP controls.

The button:

- Uses a familiar library/book icon.
- Has a tooltip such as "Prompts".
- Opens a lightweight picker popover.
- Is disabled while the current model is an image- or video-generation model
  in the first release. The feature targets conversational prompts.

### 7.2 Prompt picker

The picker contains:

- A search input focused when the picker opens.
- Compact sections for favorites and recently used Prompts.
- A filtered result list.
- Prompt name, short description, and up to two tags per row.
- A "Manage Prompts" command at the bottom.

Search matches name, description, tags, and content without case sensitivity.

Selecting a row:

1. Reads the current composer text.
2. Expands the selected template according to Section 6.
3. Replaces the composer text with the expanded result.
4. Closes the picker.
5. Focuses the composer and restores the calculated selection or cursor.
6. Records device-local recent usage without modifying the synced Prompt.

There is no confirmation dialog.

### 7.3 Prompt management

"Manage Prompts" opens a dialog with:

- A searchable Prompt list on the left.
- A focused editor on the right.
- Create, edit, favorite, and delete actions.
- A delete confirmation for custom Prompts.

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

### 7.4 First curated Prompt

The application ships this editable example:

Name: `双向钢人论证`

Description: `在做复杂判断前，强化正反双方并找出真正改变结论的变量。`

Tags: `深度思考`, `决策`, `反谄媚`

Source:
<https://mp.weixin.qq.com/s/6eDElggMR7aefaEzlWfVMA>

Content:

```text
先别急着回答，也别默认我已经把问题想清楚。

请先对这个问题做一次详细思考的“双向钢人论证”：

1. 用最完整、最有力的方式，重述我真正想解决的问题。
2. 使用钢人论证法分别给出支持我当前想法、以及反对它的最强论证。
3. 找出双方真正的分歧，以及最可能改变结论的关键变量。
4. 只问我一个最关键的问题。

等我回答后，再给出明确判断、理由和下一步行动。

我的问题是：
{{input}}
```

The seed uses a deterministic ID and fixed release timestamp shared by every
terminal. It is inserted once per local store. Deleting it creates a newer
tombstone, so a fresh terminal's fixed, older seed cannot resurrect it during
sync. A local seed-version marker prevents repeated insertion on launch.
Synced records remain normal editable Prompt records after creation.

## 8. Architecture

### 8.1 Domain and persistence

Add:

- A `PromptTemplate` type.
- A Prompt repository using the existing generic repository.
- A collection store using `createCollectionStore`.
- A sync registry entry and localized sync-resource label.
- A small first-run seeding function for the curated Prompt.
- A small device-local recent-usage store that is intentionally excluded from
  object-storage sync.

No Rust command or SQLite chat migration is required. Prompt definitions use
the Tauri Store abstraction, with the existing localStorage fallback during
browser development.

### 8.2 Object-storage backup and multi-terminal sync

Prompt synchronization reuses the existing Settings > Data Storage
configuration and sync actions. It does not add another provider configuration
or a Prompt-specific remote service.

Register the Prompt repository as a normal sync resource:

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
- Recent usage is local-only and never participates in merge conflicts.

Every successful sync includes the merged Prompt payload in the immutable
whole-archive history snapshot. Restoring the latest backup or a selected
history snapshot restores both Prompt records and tombstones. Prompt data that
is absent from an older archive is left untouched under the sync engine's
existing absent-resource rule.

After sync or restore, `reloadSyncedData()` must reload the Prompt collection
store with the other registered collection stores so the picker updates
without restarting the application.

### 8.3 Template expansion

Add a pure domain function similar to:

```ts
interface AppliedPrompt {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  titleHint?: string;
}

function applyPromptTemplate(
  template: PromptTemplate,
  currentInput: string
): AppliedPrompt;
```

`titleHint` is the trimmed pre-expansion composer text when it is non-empty.
The composer keeps this hint only until the expanded message is sent or
replaced by another Prompt.

The first user message may use `titleHint` when generating the session title.
This prevents templated sessions from all receiving a title such as
"先别急着回答". The full expanded Prompt remains the persisted user-message
content.

If the user selected a Prompt before writing any input, normal title generation
remains the fallback. Automatic title inference from arbitrary Prompt text is
out of scope.

### 8.4 UI components

Keep Prompt-specific UI outside the already large `AgentChatView.tsx`.
Suggested boundaries:

- `PromptPicker`: search, sections, selection, and manage command.
- `PromptManagerDialog`: list/editor orchestration.
- `PromptEditor`: validated Prompt fields.
- `applyPromptTemplate`: pure expansion and selection calculation.

`AgentChatView` owns only:

- Opening the picker and manager.
- Passing the current composer value.
- Applying returned text and selection.
- Holding the temporary session-title hint.

### 8.5 Existing send path

The send path remains authoritative:

1. The expanded Prompt is visible in the existing textarea.
2. `send()` reads and trims it as normal.
3. The complete text is persisted as the user message.
4. Direct chat sends it through the provider adapter.
5. Pi and external Agents receive it through their existing `prompt()` methods.
6. Follow-up turns continue normally from persisted conversation history.

No runtime signature, Agent system prompt, AAP protocol, retry protocol, or
seed-history format changes are required.

## 9. Data Flow

```text
Prompt repository
  -> Prompt collection store
  -> Prompt picker
  -> applyPromptTemplate(template, composer text)
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
- Device-local recent-usage write failure: do not roll back successful composer
  insertion.
- Sync conflict: use the existing entity `updatedAt` merge and tombstone
  behavior.
- Prompt resource pull, decryption, or parse failure: retain the current local
  Prompt collection and report the existing sync error.
- History-snapshot write failure: preserve the successful primary Prompt sync,
  matching the existing non-fatal snapshot behavior.
- Empty composer plus a template containing `{{input}}`: insertion succeeds;
  the placeholder remains visibly selected rather than sending automatically.

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

### Unit tests

Cover the pure expansion function:

- Replaces one `{{input}}` token with an existing draft.
- Replaces multiple `{{input}}` tokens.
- Appends an existing draft when no token exists.
- Selects the first token when the draft is empty.
- Places the cursor at the end when both draft and token are absent.
- Returns a trimmed existing draft as `titleHint`.
- Handles multiline and Unicode content without incorrect selection offsets.

Cover normalization and validation:

- Required name and content.
- Tag trimming and case-insensitive deduplication.
- HTTP/HTTPS source URL validation.

### Component tests

- Picker search covers name, description, tags, and content.
- Favorites and recent sections are ordered correctly.
- Applying a Prompt updates the composer and restores focus/selection.
- Manage dialog preserves values after a failed save.
- Delete requires confirmation.
- The Prompt control is unavailable for image/video-generation models.

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
- Applying a Prompt updates only local recent usage and does not alter the
  synced entity's `updatedAt`.
- Restoring a selected history snapshot restores Prompt records and tombstones,
  then refreshes the open picker without an application restart.

## 13. Acceptance Criteria

- Users can manage a persistent local collection of Prompt templates.
- Users can find a Prompt by search, favorites, recent usage, or tags.
- Selecting a Prompt exposes its full content in the composer.
- Existing composer text is never silently discarded during expansion.
- Users can edit the expanded Prompt before sending.
- `{{input}}` supports both write-first and Prompt-first workflows.
- Sending requires no hidden Prompt state and uses all existing runtime paths.
- Conversation retry remains stable if a Prompt definition later changes.
- The curated bidirectional steelman Prompt is available on first use and is
  not repeatedly recreated after deletion.
- Prompt definitions are backed up as a dedicated encrypted object-storage
  resource through the existing data-sync configuration.
- Prompt records, favorite state, edits, and deletions synchronize across
  terminals that use the same bucket, prefix, and passphrase.
- Each successful sync includes Prompt data in the encrypted history snapshot,
  and snapshot restore reloads it into the Prompt picker.
- Prompt bodies and source URLs never appear in the plaintext sync manifest.
- Device-local recent usage cannot overwrite remote Prompt content.
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
