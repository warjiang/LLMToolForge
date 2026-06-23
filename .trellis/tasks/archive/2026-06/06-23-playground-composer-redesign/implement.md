# Playground Compact Composer Redesign Implementation Plan

## Checklist

1. Add `DropdownMenuCheckboxItem` export to `src/components/ui/dropdown-menu.tsx`.
2. Import dropdown menu primitives and `RefreshCcw` in `src/pages/playground/PlaygroundPage.tsx`.
3. Replace the footer controls with a compact composer surface.
4. Add reusable inline helpers/components for Skill/MCP multi-select dropdowns and ID toggling.
5. Move attachment pills inside the composer and preserve removal behavior.
6. Remove Skill/MCP sections and related props from `ConfigRail`; keep advanced controls and tool records.
7. Center and width-limit the chat message column, error block, and composer to match the Codex Desktop reference.
8. Put attach, connection/model, refresh, Skill, MCP, and send/stop controls in one toolbar row.
9. Run `pnpm build`.

## Validation

- `pnpm build`
- Manual smoke test in Playground for connection/model selection, refresh, Skill/MCP toggle persistence, attachment removal, and send/stop.

## Rollback Notes

- The risky file is `src/pages/playground/PlaygroundPage.tsx`; changes are UI-local and can be reverted without schema migration.
