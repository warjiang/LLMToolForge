# Playground Compact Composer Redesign

## Goal

Redesign Playground composer so connection/model, model refresh, attachments, Skill and MCP selection, text input, and send controls live in one compact input surface.

## User Value

Playground users can choose the active model, refresh model lists, attach files, and enable Skills or MCP servers without leaving the message composer or opening the advanced configuration rail.

## Confirmed Facts

- `ChatSessionSettings` already persists `connKey`, `modelId`, `enabledSkillIds`, and `enabledMcpServerIds`.
- `PlaygroundPage` already derives active Skill/MCP tools from those setting fields and passes them into `toolDefinitions()` during send.
- Provider/model icons are centralized in `src/components/common/ProviderModelIcon.tsx`.
- The right configuration rail also contains advanced request parameters, sandbox mode, and tool records that should remain available.

## Requirements

- Replace the current two-row Playground footer with one compact, bordered composer surface.
- Place connection selection, model selection, and an icon-only model refresh action in the composer toolbar.
- Place Skill and MCP multi-select controls in the composer toolbar and show active counts.
- Place attach and send/stop actions in the same composer toolbar row as model, Skill, and MCP controls.
- Limit the main chat content and composer width, following the centered Codex Desktop chat layout.
- Move pending attachment chips inside the composer surface.
- Keep the textarea visually integrated and borderless inside the composer while preserving Enter-to-send and Shift+Enter newline behavior.
- Keep attach and send/stop actions icon-only.
- Remove duplicated Skill/MCP toggle sections from the right configuration rail.
- Preserve advanced rail controls for Ark API Key, wire format, system prompt, temperature, max tokens, streaming, sandbox mode, and tool records.
- Reuse existing setting fields and provider/model fetch behavior; do not change persistence schema or provider adapter contracts.

## Acceptance Criteria

- [ ] Connection and model can be selected from the composer.
- [ ] Model refresh works for the current connection and uses an icon-only `RefreshCcw` button.
- [ ] Skill and MCP menus show only enabled items, toggle multiple selections, and persist through session settings.
- [ ] Skill/MCP empty states are visible and disabled when no enabled items exist.
- [ ] Attach, connection/model, refresh, Skill, MCP, and send/stop controls share one compact toolbar row on desktop.
- [ ] Chat messages, errors, and composer are width-limited and centered in the main conversation pane.
- [ ] Attachments render inside the composer and can still be removed before sending.
- [ ] Sending, stopping, keyboard submission, and attachment selection continue to work.
- [ ] Right configuration rail no longer duplicates Skill/MCP selection, but still exposes advanced settings and tool records.
- [ ] `pnpm build` succeeds.

## Notes

- `PRODUCT.md` and `DESIGN.md` are absent, so use the existing Geist/product UI vocabulary.
- Scope is a UI/state wiring redesign only; no database migrations, provider adapters, or tool execution pipeline replacement.
