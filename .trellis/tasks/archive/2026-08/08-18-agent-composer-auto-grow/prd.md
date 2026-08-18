# Agent Composer Auto Grow

## Goal

Make long Agent prompts easy to read and edit without making the composer
permanently large for short messages.

## Confirmed Facts

- The Agent composer currently forces its textarea to `52px` height and disables
  manual resizing.
- The composer sits in a shrinkable flex layout, so it can grow upward while the
  message list yields space.
- Prompt templates and starter prompts update the textarea value
  programmatically.
- Prompt template application depends on the existing textarea ref to restore
  focus and selection.

## Requirements

- Keep the empty and one-line composer at its current compact height.
- Grow the textarea automatically as content wraps or gains new lines.
- Cap compact auto-growth at roughly 30% of the viewport, up to `240px`.
- Once the compact cap is reached, keep the composer height stable and scroll
  inside the textarea.
- Add a familiar icon button that toggles a focused editing state.
- Focused editing gives the textarea substantially more vertical space while
  keeping attachments, model controls, tools, and the send button visible. On
  short viewports, editor height yields to the toolbar instead of overflowing.
- Preserve Enter-to-send, Shift+Enter-to-insert-newline, paste handling, prompt
  template insertion, focus, and selection behavior.
- Collapse focused editing after a successful send begins and when switching
  sessions.
- Recalculate dimensions after user input, programmatic value changes, focus
  mode changes, and viewport resizing.
- Provide Chinese and English accessible labels for expand and collapse.

## Acceptance Criteria

- [x] Empty and one-line input renders at `52px`.
- [x] Multi-line input grows until the compact cap and does not show an internal
  scrollbar below that cap.
- [x] Content beyond the compact cap scrolls inside the textarea.
- [x] Expanding targets `clamp(240px, 55vh, 560px)` and reduces further only
  when required to keep the complete composer footer visible.
- [x] Collapsing returns to content-based compact sizing.
- [x] The expand/collapse control uses Lucide icons and has localized tooltips.
- [x] Sending and changing sessions collapse the focused editor.
- [x] Prompt insertion still focuses the textarea and restores the intended
  selection.
- [x] Focused unit tests cover compact growth, compact overflow, focused height,
  collapse, and viewport resize.
- [x] Type checking, targeted tests, and the production build pass.

## Out of Scope

- Drag-to-resize behavior.
- Persisting focused mode across sessions or application restarts.
- A full-screen editor modal.
- Changes to the shared `Textarea` component or non-Agent textareas.
