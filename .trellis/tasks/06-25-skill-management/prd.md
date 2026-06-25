# Implement Skill Management

## Goal

Implement practical skill management in LLMToolForge so users can maintain reusable skills and configure them for coding agents, OpenClaw, Hermes Agent, and project-specific agent workspaces.

The user request explicitly references `xingkongliang/skills-manager`; this project should adopt the useful product ideas that fit LLMToolForge without recreating the full external app:

- a central skill library
- per-agent skill assignment
- global and project workspaces
- support for mainstream coding agents plus OpenClaw and Hermes
- real output into the agent skill folders, not only in-app metadata

## Requirements

- Keep the existing `Skills` page as the home for skill management.
- Support creating, editing, enabling/disabling, tagging, and deleting skills.
- Extend skills from simple records into deployable skill folders using `SKILL.md` as the canonical entry file.
- Support assigning skills to multiple target agents.
- Include at least these built-in targets:
  - Claude Code
  - Codex
  - Cursor
  - OpenCode
  - Gemini CLI
  - GitHub Copilot
  - Kiro
  - Qoder
  - Droid
  - OpenClaw
  - Hermes Agent
- Support global agent configuration using each target's global skills directory.
- Support project-level configuration by letting the user create project workspaces with:
  - project name
  - project path
  - target agents
  - selected skills
  - copy or symlink sync mode
- Support syncing selected skill configurations to the filesystem from the Tauri app.
- Use copy mode as the safe default.
- For project-level paths, write to each agent's project-relative skills directory under the configured project root.
- Provide a clear sync result in the UI, including successful writes and errors.
- Keep compatibility with existing stored skills that only have `name`, `description`, `tags`, `content`, and `enabled`.
- Do not implement marketplace search, git backup, upstream update tracking, diff viewing, or full preset management in this task.

## Acceptance Criteria

- [ ] Users can create and edit skills with name, description, tags, content, enabled state, and assigned agents.
- [ ] The Skills page shows agent assignment state on each skill.
- [ ] Users can trigger global sync for selected/assigned skills and see per-agent results.
- [ ] Users can create project-level skill configurations with a project path, target agents, selected skills, and sync mode.
- [ ] Users can trigger project sync and the app writes skill folders into the configured project's agent-specific skill directories.
- [ ] Generated skill folders contain a `SKILL.md`.
- [ ] OpenClaw uses `.openclaw/skills`.
- [ ] Hermes Agent uses `.hermes/skills`.
- [ ] Codex uses `.codex/skills` for both global and project-level paths.
- [ ] Existing skill records continue to load without data migration errors.
- [ ] `pnpm build` passes.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
