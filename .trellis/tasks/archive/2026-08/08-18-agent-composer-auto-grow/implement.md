# Agent Composer Auto Grow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add compact content-driven growth and an explicit focused editing mode
to the Agent composer.

**Architecture:** A small hook measures and sizes the existing textarea ref.
`AgentChatView` retains only the focused-mode state and lifecycle integration.
No shared component or persistent store changes are required.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Tailwind CSS,
Lucide React.

---

### Task 1: Implement Tested Composer Sizing

**Files:**
- Create: `src/pages/agent/composer/useComposerAutoResize.ts`
- Create: `src/pages/agent/composer/tests/use-composer-auto-resize.test.tsx`
- Modify: `vitest.config.ts`

- [x] **Step 1: Write failing calculation and hook tests**

Cover these behaviors with a small React harness:

```ts
expect(composerHeight(900, false)).toBe(240);
expect(composerHeight(600, true)).toBe(330);
expect(composerHeight(300, true)).toBe(240);
expect(composerHeight(1400, true)).toBe(560);
```

Set a synthetic textarea `scrollHeight` and assert:

```ts
expect(textarea.style.height).toBe("140px");
expect(textarea.style.overflowY).toBe("hidden");
```

Then cover compact overflow, focused height, collapse, and a dispatched window
`resize` event.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm test -- src/pages/agent/composer/tests/use-composer-auto-resize.test.tsx
```

Expected: FAIL because `useComposerAutoResize` and `composerHeight` do not exist.

- [x] **Step 3: Implement the minimum sizing hook**

Export viewport constants, a pure `composerHeight(viewportHeight, expanded)`
calculation, and:

```ts
useComposerAutoResize({
  textareaRef,
  value,
  expanded,
});
```

Use `useLayoutEffect` for value/focus changes, a window `resize` listener, and
`ResizeObserver` for internal pane/footer geometry changes. Apply `52px`
minimum, compact `min(30vh, 240px)`, focused
`clamp(240px, 55vh, 560px)`, and overflow based on measured content.

- [x] **Step 4: Run the focused test and verify GREEN**

Run the same test command. Expected: all new tests pass without warnings.

### Task 2: Integrate Focused Editing

**Files:**
- Modify: `src/pages/agent/AgentChatView.tsx`
- Modify: `src/i18n/locales/en/pages.json`
- Modify: `src/i18n/locales/zh/pages.json`

- [x] **Step 1: Add focused-mode state and hook wiring**

Add local `composerExpanded` state and call `useComposerAutoResize` with the
existing prompt-composer textarea ref and controlled input.

- [x] **Step 2: Add the expand/collapse control**

Place an icon-only button at the textarea's top right. Render `Maximize2` while
compact and `Minimize2` while focused. Use localized tooltip and aria-label
keys. Reserve right padding in the textarea and remove the fixed-height class;
the hook owns inline height.

- [x] **Step 3: Add lifecycle resets**

Collapse focused mode after send begins and whenever the active session ID
changes. Keep the textarea focused after the user toggles the control.

- [x] **Step 4: Run targeted regressions**

Run:

```bash
pnpm test -- \
  src/pages/agent/composer/tests/use-composer-auto-resize.test.tsx \
  src/pages/agent/prompts/tests/prompt-composer-apply.test.tsx
```

Expected: all tests pass.

### Task 3: Validate the Complete Change

**Files:**
- Update: `.trellis/tasks/08-18-agent-composer-auto-grow/prd.md`
- Create: `.trellis/tasks/08-18-agent-composer-auto-grow/manual-acceptance.md`

- [x] **Step 1: Run static and automated verification**

```bash
pnpm test
pnpm build
```

Expected: full Vitest suite and TypeScript/Vite production build pass.

- [x] **Step 2: Verify desktop and narrow layouts**

Use the running app to verify short, multiline, overflow, expand, collapse,
send, session switch, prompt insertion, and viewport resize behavior. Confirm
the toolbar remains usable and no text or controls overlap.

- [x] **Step 3: Record evidence**

Write the tested viewport sizes and results to `manual-acceptance.md`, then mark
the PRD acceptance criteria complete only where evidence exists.

## Self-Review

- Every PRD requirement maps to a task above.
- Production behavior begins with a failing focused test.
- The hook and view use the same `expanded` terminology and the existing
  textarea ref.
- No placeholders, persistent state, shared textarea changes, or unrelated
  refactors are included.
