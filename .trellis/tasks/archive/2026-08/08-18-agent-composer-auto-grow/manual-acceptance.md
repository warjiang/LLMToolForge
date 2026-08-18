# Agent Composer Auto Grow Manual Acceptance

Date: 2026-08-19

## Automated Evidence

- Focused red/green test:
  `pnpm test -- src/pages/agent/composer/tests/use-composer-auto-resize.test.tsx`
  - Initial failure: sizing module missing.
  - Boundary regression failure: fitting helper missing.
  - Final result: 8 tests passed.
- Prompt integration regression:
  `src/pages/agent/prompts/tests/prompt-composer-apply.test.tsx` passed.
- Final full suite: 22 test files, 136 tests passed.
- Final production build: `tsc && vite build` passed.
- Independent review found one Important stale-geometry issue; the
  `ResizeObserver` fix was independently re-reviewed with no remaining Critical
  or Important findings.

## Browser Evidence

### Narrow viewport: 643 x 454

- Empty input: `52px`, `overflow-y: hidden`.
- Long compact input: `136px`, `overflow-y: auto`; this matches the `30vh`
  compact cap.
- Initial focused target was `250px`, which pushed the wrapped `112px` toolbar
  below the pane boundary.
- After boundary fitting, focused input became `169px`; footer and pane bottoms
  both measured `454px`.
- Textarea retained focus after expanding.
- Sending restored the localized `展开编辑区` control.
- Creating a new session while expanded restored the `展开编辑区` control.

### Desktop viewport: 1440 x 900

- Long compact input: `240px`, `overflow-y: auto`.
- Focused input: `495px`, matching `55vh`, `overflow-y: hidden`.
- Toolbar bottom: `883px`; Agent pane bottom: `900px`.
- Collapsing restored `240px` compact sizing.
- Screenshot: `/tmp/agent-composer-desktop.png`.

### Internal resize: 1100 x 700

- Opening the config rail without resizing the window changed textarea width
  from `798px` to `514px`.
- `ResizeObserver` recalculated compact height from `199px` to its `210px` cap
  as content wrapped.
- Focused height was `385px`; footer and Agent pane bottoms both measured
  `700px`.
- No browser console errors were emitted.

## Visual Review

- Expand/collapse icon stays in the textarea top-right reserved area.
- Text does not run under the icon.
- Model selector, sandbox mode, Prompt, Skills, MCP, Connector, and send controls
  remain mounted in both modes.
- No overlapping controls were observed at either tested viewport.
