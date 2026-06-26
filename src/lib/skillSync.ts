import type { Skill, SkillFile, SkillSyncMode } from "@/types";
import i18n from "@/i18n/config";
import type { SkillTarget } from "@/lib/skillTargets";
import { projectTargetDir } from "@/lib/skillTargets";

export interface SyncSkillPayload {
  id: string;
  name: string;
  description: string;
  tags: string[];
  content?: string;
  enabled: boolean;
  files?: SkillFile[];
}

export interface SyncTargetPayload {
  agentKey: string;
  agentName: string;
  scope: "global" | "project";
  targetDir: string;
  projectName?: string;
}

export interface SyncSkillsRequest {
  mode: SkillSyncMode;
  skills: SyncSkillPayload[];
  targets: SyncTargetPayload[];
}

export interface SyncSkillResult {
  skillId: string;
  skillName: string;
  agentKey: string;
  agentName: string;
  scope: "global" | "project";
  targetPath: string;
  status: "success" | "error";
  error?: string;
}

export function skillPayload(skill: Skill): SyncSkillPayload {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    tags: skill.tags,
    content: skill.content,
    enabled: skill.enabled,
    files: skill.files,
  };
}

export function globalTargetPayload(target: SkillTarget): SyncTargetPayload {
  return {
    agentKey: target.key,
    agentName: target.name,
    scope: "global",
    targetDir: target.globalSkillsDir,
  };
}

export function projectTargetPayload(
  target: SkillTarget,
  projectName: string,
  projectPath: string
): SyncTargetPayload {
  return {
    agentKey: target.key,
    agentName: target.name,
    scope: "project",
    targetDir: projectTargetDir(projectPath, target),
    projectName,
  };
}

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

export async function syncSkillsToTargets(
  request: SyncSkillsRequest
): Promise<SyncSkillResult[]> {
  if (!isTauriRuntime()) {
    throw new Error(i18n.t("skill_sync_requires_tauri", { ns: "common" }));
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SyncSkillResult[]>("sync_skills_to_targets", { request });
}
