# Skill Management Design

## Confirmed Facts

- LLMToolForge is a React 19 + TypeScript + Vite + Tauri 2 app.
- The current app already has a `Skills` route, `SkillsPage`, `SkillDialog`, `Skill` type, `skillRepo`, and `useSkillStore`.
- Current skill storage is generic local persistence via `Repository<T>` and `createCollectionStore`, backed by Tauri Store or localStorage.
- Current skills are already used by Playground as callable tool definitions through per-chat `enabledSkillIds`.
- Tauri already exposes app commands through `src-tauri/src/lib.rs`.
- `xingkongliang/skills-manager` uses a central library, agent adapters, global workspaces, project workspaces, copy/symlink sync, and `SKILL.md`-based skill folders.
- Reference adapter paths relevant to this task:
  - Codex: `.codex/skills`
  - OpenClaw: `.openclaw/skills`
  - Hermes Agent: `.hermes/skills`, recursive scanning in the reference app
  - OpenCode: global `.config/opencode/skills`, project `.opencode/skills`

## Architecture

Keep this as a local-first frontend feature with a small Tauri filesystem command.

### Frontend Model

Extend `Skill` with optional deployment metadata:

- `agentKeys?: SkillAgentKey[]`
- `syncMode?: "copy" | "symlink"`

Add a new persisted collection for project-level configurations:

- `SkillProjectConfig`
  - `name`
  - `projectPath`
  - `agentKeys`
  - `skillIds`
  - `syncMode`
  - `enabled`

The model intentionally keeps global assignment on each skill because global sync is a direct property of a reusable library skill. Project assignment is separate because the same skill can be enabled for different projects and different agents.

### Agent Registry

Create a TypeScript registry in `src/lib/skillTargets.ts`:

- stable agent key
- display name
- category
- global skills path
- project-relative skills path
- optional notes

The frontend computes target paths for global and project sync. Built-in default paths can use `~`, and the Tauri command expands it.

### Sync Command

Add a Tauri command:

- `sync_skills_to_targets(request)`

Inputs:

- skills: serializable skill payloads
- targets: resolved target directories with labels and scope
- mode: copy or symlink

Behavior:

- Create target directory if missing.
- Slugify skill name for the folder name.
- Write/copy a generated skill folder containing `SKILL.md`.
- In copy mode, overwrite the managed skill folder for that skill.
- In symlink mode, create a temporary source skill folder under the app config directory and symlink the target folder to it.
- Return per-skill/per-target results with status, path, and error.

### Generated Skill Document

Generate `SKILL.md` from skill metadata:

```md
---
name: <safe name>
description: <description>
---

<content or description>
```

This matches the `SKILL.md` convention from the reference project and the broader skills ecosystem.

## UI Shape

Use the existing `SkillsPage` and add two compact sections:

- Library: existing skill cards, enhanced with assigned agent badges and sync actions.
- Project Configs: project workspaces with project path, target agents, selected skills, sync mode, and sync button.

Keep all controls dense and operational, matching the current app style. Do not add a marketing-style page.

## Compatibility

- Existing records without new optional fields default to no agent assignment and copy mode.
- Existing Playground skill behavior remains unchanged.
- No database migration is required because the generic store persists JSON arrays.

## Tradeoffs

- This MVP does not scan existing agent folders back into the app. It only writes configured skills outward.
- This MVP does not implement marketplace install, git sync, presets, or update tracking.
- The app trusts user-provided project paths because this is an explicit local desktop configuration action.
