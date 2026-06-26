# Skill Management Page Redesign

## Goal

Upgrade the Skill management experience into a polished, dense, professional workstation UI while preserving existing skill CRUD, market install, update checking, and filesystem sync behavior.

## Requirements

- Keep the existing React 19 + TypeScript + Vite + Tauri 2 + Tailwind v3 + Radix stack.
- Do not add runtime dependencies, migrate UI frameworks, or change backend/Tauri sync semantics.
- Redesign the `/skills` page, including Skill Library and Project Config tabs.
- Add a compact summary area for total skills, assigned/syncable skills, project configs, and market-sourced skills.
- Improve Skill cards so enabled state, source, target agents, sync mode, files, requirements, and actions are easy to scan.
- Improve Project Config cards so project path, target agents, selected skills, sync readiness, disabled reasons, and actions are easy to scan.
- Improve sync result rendering with clear success/error counts, failed rows, target paths, and user-facing errors.
- Improve all related dialogs: Skill create/edit, Project create/edit, market install, updates, and requirement indicators.
- Keep long dialog footers reachable at default desktop viewport by keeping scrollable content separate from actions.
- Keep all new user-facing strings in `src/i18n/locales/en/pages.json` and `src/i18n/locales/zh/pages.json`.
- Preserve compatibility with existing skill records and project config records.

## Acceptance Criteria

- [x] `/skills` renders a workstation-style header/summary section without marketing-page styling.
- [x] Skill Library tab supports empty and populated states with no text overflow at desktop, tablet, and narrow widths.
- [x] Skill cards show assignment, status, sync mode, source, file count, requirements, and action state clearly.
- [x] Project Config tab supports empty and populated states with clear sync readiness and disabled reasons.
- [x] Sync results show success count, failure count, failed skill/agent/path/error details, and command-level errors.
- [x] Skill, project, market, and update dialogs have reachable footers and consistent form/row hierarchy.
- [x] No changes are made to `syncSkillsToTargets` payload shape or Tauri command behavior.
- [x] Existing Playground skill selection behavior remains unchanged.
- [x] `pnpm build` passes.

## Notes

- This task follows the existing skill-management contracts in `.trellis/spec/frontend/skill-management-contracts.md`.
- This is a visual and UX refinement task; it is not a data migration or sync backend task.
