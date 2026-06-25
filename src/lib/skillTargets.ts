import type { SkillAgentKey, SkillSyncMode } from "@/types";

export interface SkillTarget {
  key: SkillAgentKey;
  name: string;
  category: "coding" | "lobster";
  globalSkillsDir: string;
  projectSkillsDir: string;
  note?: string;
}

export const SKILL_SYNC_MODES: { value: SkillSyncMode; label: string }[] = [
  { value: "copy", label: "skill_sync_mode_copy" },
  { value: "symlink", label: "skill_sync_mode_symlink" },
];

export const SKILL_TARGETS: SkillTarget[] = [
  {
    key: "claude_code",
    name: "Claude Code",
    category: "coding",
    globalSkillsDir: "~/.claude/skills",
    projectSkillsDir: ".claude/skills",
  },
  {
    key: "codex",
    name: "Codex",
    category: "coding",
    globalSkillsDir: "~/.codex/skills",
    projectSkillsDir: ".codex/skills",
  },
  {
    key: "cursor",
    name: "Cursor",
    category: "coding",
    globalSkillsDir: "~/.cursor/skills",
    projectSkillsDir: ".cursor/skills",
  },
  {
    key: "opencode",
    name: "OpenCode",
    category: "coding",
    globalSkillsDir: "~/.config/opencode/skills",
    projectSkillsDir: ".opencode/skills",
  },
  {
    key: "gemini_cli",
    name: "Gemini CLI",
    category: "coding",
    globalSkillsDir: "~/.gemini/skills",
    projectSkillsDir: ".gemini/skills",
  },
  {
    key: "github_copilot",
    name: "GitHub Copilot",
    category: "coding",
    globalSkillsDir: "~/.copilot/skills",
    projectSkillsDir: ".copilot/skills",
  },
  {
    key: "kiro",
    name: "Kiro",
    category: "coding",
    globalSkillsDir: "~/.kiro/skills",
    projectSkillsDir: ".kiro/skills",
  },
  {
    key: "qoder",
    name: "Qoder",
    category: "coding",
    globalSkillsDir: "~/.qoder/skills",
    projectSkillsDir: ".qoder/skills",
  },
  {
    key: "droid",
    name: "Droid",
    category: "coding",
    globalSkillsDir: "~/.factory/skills",
    projectSkillsDir: ".factory/skills",
  },
  {
    key: "openclaw",
    name: "OpenClaw",
    category: "lobster",
    globalSkillsDir: "~/.openclaw/skills",
    projectSkillsDir: ".openclaw/skills",
  },
  {
    key: "hermes",
    name: "Hermes Agent",
    category: "lobster",
    globalSkillsDir: "~/.hermes/skills",
    projectSkillsDir: ".hermes/skills",
    note: "skill_target_hermes_note",
  },
];

export function getSkillTarget(key: string): SkillTarget | null {
  return SKILL_TARGETS.find((target) => target.key === key) ?? null;
}

export function skillTargetName(key: string): string {
  return getSkillTarget(key)?.name ?? key;
}

export function projectTargetDir(projectPath: string, target: SkillTarget): string {
  const root = projectPath.trim().replace(/[\\/]+$/, "");
  return `${root}/${target.projectSkillsDir}`;
}

export function selectedTargets(keys: readonly SkillAgentKey[]): SkillTarget[] {
  const selected = new Set(keys);
  return SKILL_TARGETS.filter((target) => selected.has(target.key));
}
