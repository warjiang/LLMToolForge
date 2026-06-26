# Implementation Plan

## Checklist

- [x] Read relevant frontend specs and current skill-management code.
- [x] Redesign `SkillsPage` summary, tabs, action bars, Skill cards, Project cards, and sync result panel.
- [x] Redesign Skill create/edit and Project create/edit dialogs with grouped scrollable form sections.
- [x] Redesign market install dialog rows, empty/loading/error states, and token section hierarchy.
- [x] Redesign updates dialog rows, empty/loading/error states, and footer summary.
- [x] Polish `SkillRequires` to fit the denser workstation style.
- [x] Add/adjust English and Chinese i18n keys.
- [x] Run `pnpm build`.
- [x] Review git diff for accidental contract or backend changes.

## Validation

```bash
pnpm build
```

Manual checks:

- `/skills` with no skills, with multiple skills, with unassigned skills, and with GitHub-sourced skills.
- Skill cards with multiple agents, multiple files, missing requirements, enabled and disabled states.
- Project cards with no path, no agents, no skills, disabled project, and selected disabled skills.
- Skill, project, market, and update dialogs at default desktop viewport and narrow width.
- Sync result panel with successes, failures, and command-level errors.

## Rollback

- Revert the frontend UI and i18n changes in this task.
- No filesystem sync or data model rollback should be needed because this task does not change those contracts.
