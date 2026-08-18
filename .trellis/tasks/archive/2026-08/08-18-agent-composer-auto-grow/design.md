# Agent Composer Auto Grow Design

## Problem

The composer textarea has both `h-[52px]` and `resize-none`. Although it also
declares `max-h-32`, no mechanism updates its height, so long input remains
confined to about two visible lines.

## Chosen Interaction

Use the approved hybrid design:

1. Keep the textarea at `52px` for empty and short input.
2. Grow with content until `min(30vh, 240px)`.
3. Switch to internal textarea scrolling above that compact cap.
4. Offer a top-right expand/collapse icon.
5. In focused mode, allocate `clamp(240px, 55vh, 560px)` to the editor while
   leaving the composer toolbar mounted and usable. If that desired height
   would push the footer past the Agent pane boundary, subtract the measured
   overflow from the textarea height.

Focused mode is ephemeral. It collapses on send and active-session changes.

## Boundaries

### `useComposerAutoResize`

A focused hook owns DOM sizing only. It receives the existing textarea ref,
current value, and focused-state flag.

On layout:

- Reset the inline height to the compact minimum so `scrollHeight` reflects the
  current content rather than a previous larger size.
- Compact mode sets height to the lesser of content height and compact cap.
- Focused mode sets height to the viewport-derived focused height.
- Focused mode measures the complete composer footer against the Agent pane and
  reduces textarea height when required to keep controls visible.
- Set `overflowY` to `auto` only when content exceeds the allocated height.

The hook listens for window resize and uses `ResizeObserver` on the Agent pane
boundary and composer footer. A geometry signature containing pane dimensions,
footer width, and non-textarea chrome height prevents observer loops while
still catching config/preview rail resizing, toolbar wrapping, and attachment
layout changes. Constants and pure height calculations remain exported for
deterministic unit tests.

### `AgentChatView`

The view owns the ephemeral `composerExpanded` boolean because send and session
events already live there. It:

- Calls the hook with the textarea ref already returned by
  `usePromptComposerApply`.
- Renders a Lucide `Maximize2` or `Minimize2` icon button inside the composer.
- Adds right padding to prevent text from sitting behind the icon.
- Clears expanded state when send starts and when the active session changes.

No changes are made to prompt application, message persistence, the shared
textarea component, or global stores.

## Data Flow

1. Input changes through typing, paste, starter prompt, or prompt template.
2. React commits the new controlled textarea value.
3. A layout effect measures `scrollHeight` and writes `height` and `overflowY`.
4. Toggling focused mode reruns the layout effect without changing input.
5. Viewport or observed pane/footer geometry changes reapply dimensions.

## Accessibility

- Use familiar Lucide maximize/minimize icons.
- The button has localized `title` and `aria-label` text.
- Keyboard behavior inside the textarea is unchanged.
- Focus remains in the textarea after toggling focused mode.

## Testing

- Pure calculation tests verify compact and focused caps.
- A React hook harness supplies a synthetic `scrollHeight` and verifies inline
  height and overflow changes for value, focus mode, and resize events.
- Existing prompt composer tests guard focus and selection behavior.
- Type checking and production build cover the `AgentChatView` integration.

## Rollback

The change is isolated to one new hook, one focused test file, two locale keys,
and the composer markup. Rollback removes those additions and restores the
existing fixed textarea class.
