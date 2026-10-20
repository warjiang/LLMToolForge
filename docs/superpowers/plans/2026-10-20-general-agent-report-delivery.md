# General Agent Report Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each General Agent session an explicit report delivery setting that defaults to chat Markdown and enables the existing HTML artifact workflow only when selected.

**Architecture:** Keep `ReportDelivery` normalization beside `ChatSessionSettings`, persist it through the SQLite and browser-fallback repository, and reset it to `chat` for every new session. Move General Agent construction and runtime signature into testable modules; a pure profile resolver owns delivery instructions, tool filtering, and the chat output-token floor. Surface the setting only for General Agent sessions in the existing configuration rail.

**Tech Stack:** React, TypeScript, Zustand, Tauri SQLite, Vitest, pnpm.

---

### Task 1: Specify Report Delivery Persistence

**Files:**
- Modify: `src/types/chat.ts`
- Modify: `src/data/chatRepository.ts`
- Create: `src/data/tests/chat-report-delivery.test.ts`
- Modify: `vitest.config.ts`

- [x] **Step 1: Write failing browser-fallback tests**

Test normalizer behavior, legacy fallback normalization, update/get round-trip, and seeded-session reset:

```ts
expect(normalizeReportDelivery(undefined)).toBe("chat");
expect(normalizeReportDelivery("html")).toBe("html");
const updated = await chatRepo.updateSettings(session.id, {
  reportDelivery: "html",
});
expect(updated.reportDelivery).toBe("html");
expect((await chatRepo.getSettings(session.id)).reportDelivery).toBe("html");
```

- [x] **Step 2: Run the focused test**

Run: `pnpm vitest run src/data/tests/chat-report-delivery.test.ts`
Expected: FAIL because `reportDelivery` and `normalizeReportDelivery` do not exist.

- [x] **Step 3: Implement the shared setting and repository mapping**

Add `"chat" | "html"` plus `normalizeReportDelivery` to `src/types/chat.ts`, default it to `chat`, normalize fallback and SQLite reads, and persist it in the schema, migration, raw upsert SQL, and parameter list. Ensure `settingsForNewSession` explicitly writes `reportDelivery: "chat"` while retaining the existing seed fields.

- [x] **Step 4: Register and run the focused test**

Add `src/data/tests/chat-report-delivery.test.ts` to the explicit Vitest include list, then run:

```bash
pnpm vitest run src/data/tests/chat-report-delivery.test.ts
```

Expected: PASS.

### Task 2: Make the General Agent Profile Testable

**Files:**
- Create: `src/pages/agent/generalAgentProfile.ts`
- Create: `src/pages/agent/agentRuntimeSignature.ts`
- Create: `src/pages/agent/tests/general-agent-profile.test.ts`
- Modify: `src/pages/agent/AgentChatView.tsx`
- Modify: `vitest.config.ts`

- [x] **Step 1: Write failing profile tests**

Cover chat tool exclusion, HTML tool equality, prompt ordering, empty-prompt handling, token limits, chat instruction safeguards, and signature changes:

```ts
expect(resolveGeneralAgentProfile(chatSettings).enabledInternalTools)
  .not.toContain("html_artifact_create");
expect(resolveGeneralAgentProfile(htmlSettings).enabledInternalTools)
  .toEqual(AGENT_INTERNAL_TOOL_IDS);
expect(resolveGeneralAgentProfile({ ...base, maxTokens: "1024" }).maxTokens)
  .toBe(8192);
```

- [x] **Step 2: Run the focused test**

Run: `pnpm vitest run src/pages/agent/tests/general-agent-profile.test.ts`
Expected: FAIL because the resolver and extracted functions do not exist.

- [x] **Step 3: Implement the resolver and extracted AgentDefinition builder**

Create the pure resolver with `CHAT_REPORT_MIN_MAX_TOKENS = 8192`, all specified chat and HTML instructions, and the chat-only removal of `data_report_html`, `html_artifact_create`, and `html_artifact_block`. Move `ADHOC_AGENT_ID` and `buildAdHocAgentDef` to that module so it consumes the resolved profile. Move the unchanged runtime-signature function to its own module.

- [x] **Step 4: Integrate without changing built-in or custom agents**

Import `buildAdHocAgentDef` and `agentRuntimeSignature` from their new modules in `AgentChatView.tsx`; leave DataAgent, ResearchAgent, and saved agent definitions unchanged.

- [x] **Step 5: Register and run the focused test**

Add the test path to `vitest.config.ts`, then run:

```bash
pnpm vitest run src/pages/agent/tests/general-agent-profile.test.ts
```

Expected: PASS.

### Task 3: Expose the Current-Session Control

**Files:**
- Modify: `src/pages/agent/AgentChatView.tsx`
- Modify: `src/i18n/locales/en/pages.json`
- Modify: `src/i18n/locales/zh/pages.json`

- [x] **Step 1: Add the i18n labels**

Add `agent_report_delivery`, `agent_report_delivery_chat`, and `agent_report_delivery_html` with the approved English and Chinese strings.

- [x] **Step 2: Add General-Agent-only configuration UI**

Pass `isGeneralAgent={selectedAgentId === null}` into `ConfigRail`. In the sandbox section, render the compact label/control `Select` only when it is true and call the existing `onSettings({ reportDelivery })` path. Do not change the composer, DataAgent, ResearchAgent, or custom-agent UI.

- [x] **Step 3: Run focused tests**

```bash
pnpm vitest run src/data/tests/chat-report-delivery.test.ts src/pages/agent/tests/general-agent-profile.test.ts
```

Expected: PASS.

### Task 4: Verify the Full Change

**Files:**
- Review: changed source and test files

- [x] **Step 1: Run all automated checks**

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

Expected: all commands succeed.

- [ ] **Step 2: Manually test SQLite delivery persistence in Tauri**

Run `pnpm tauri:dev`, verify legacy General Agent sessions show Chat Markdown, HTML persists across restart, chat delivery creates no report artifact, a new session resets to chat, and DataAgent/ResearchAgent do not show the control.

- [x] **Step 3: Review the final diff**

Confirm no Rust artifact, preview/export, or named-agent tool-selection code changed; verify `report_delivery` appears in create, migration, read, upsert, and seed-reset paths.
