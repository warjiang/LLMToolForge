# Implementation Plan

## Checklist

- [x] Load pre-development Trellis guidance before editing.
- [x] Extend shared types for deployable skills and project configs.
- [x] Add repository/store support for project skill configs.
- [x] Add agent target registry and skill export helpers.
- [x] Add Tauri sync command for copy/symlink filesystem writes.
- [x] Register the Tauri command in the invoke handler.
- [x] Add frontend invoke wrapper for sync.
- [x] Extend `SkillDialog` with agent assignment and sync mode.
- [x] Rework `SkillsPage` to show agent assignments, global sync, project configs, and sync results.
- [x] Keep Playground skill selection behavior intact.
- [x] Run `pnpm build`.

## Validation

```bash
pnpm build
```

Manual checks:

- Create a skill and assign Codex + OpenClaw.
- Global sync writes `SKILL.md` into the configured target folders.
- Create a project config for Codex + Hermes.
- Project sync writes to `<project>/.codex/skills/<skill>/SKILL.md` and `<project>/.hermes/skills/<skill>/SKILL.md`.
- Existing skills without `agentKeys` render normally.

## Risk Points

- Filesystem writes must report per-target errors rather than failing silently.
- Symlink behavior differs on Windows; return explicit errors if symlink creation fails.
- Generated folder names must be stable and path-safe.
- Existing skill records must not require migration.

## Rollback

- Revert the new Tauri command and frontend sync UI.
- Keep existing skill CRUD untouched if a partial rollback is needed.
