# Skill Management Page Redesign Design

## Current State

- `SkillsPage` already owns Skill Library and Project Config tabs, global/project sync actions, result rendering, and dialogs.
- `SkillDialog`, `SkillProjectDialog`, `SkillMarketDialog`, `SkillUpdatesDialog`, and `SkillRequires` already cover the core workflows.
- The UI works but reads as generic card grids and stacked forms. It needs stronger hierarchy, clearer status grouping, and more resilient responsive layout.

## UI Design

- Keep the app's existing Geist/Tailwind/Radix component language.
- Add local presentation helpers inside the skill page modules rather than introducing a new design system.
- Use compact operational surfaces: summary metrics, section headers, readiness strips, status chips, and denser row layouts.
- Keep Skill and Project cards as cards because they represent repeated management entities, but reduce generic card feel through internal grid hierarchy, aligned footers, status rows, and subdued backgrounds.
- Keep dialogs as Radix dialogs; improve inner content with grouped panels and scrollable regions, keeping `DialogFooter` outside the scroll area.
- Use existing icons from lucide-react and existing `Button`, `Badge`, `Card`, `Tabs`, `EmptyState`, and `Reveal` primitives.

## Behavior and Contracts

- Do not change `Skill`, `SkillProjectConfig`, `SyncSkillsRequest`, or `SyncSkillResult`.
- Global sync continues to use each skill's `agentKeys` and `syncMode`.
- Project sync continues to resolve target directories through `selectedTargets` and `projectTargetPayload`.
- Missing sync readiness is only reflected in disabled state and explanatory UI, not by changing command behavior.
- Existing i18n namespaces remain unchanged.

## Compatibility

- Existing records without `agentKeys`, `syncMode`, `files`, `requires`, or market metadata must render gracefully.
- Browser runtime still throws for sync command through `syncSkillsToTargets`; the UI should show that as an error.
- No routing or Tauri command registration changes are needed.
