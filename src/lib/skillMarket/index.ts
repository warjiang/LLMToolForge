/**
 * Unified skill-market facade.
 *
 * Exposes a single search/resolve surface over the available providers
 * (GitHub direct + skills.sh) and the helpers the UI needs to turn a resolved
 * skill into a stored `Skill`, including install-status detection so the same
 * skill isn't silently duplicated.
 */

import type {
  MarketSkillDetail,
  MarketSkillSummary,
  Skill,
} from "@/types";
import { listRepoSkills, parseRepoRef, resolveGithubSkill } from "./github";
import { resolveSkillsShSkill, searchSkillsSh } from "./skillsSh";

export { parseRepoRef, listRepoSkills } from "./github";
export {
  searchSkillsSh,
  UnsupportedSkillSourceError,
  isGithubBackedSource,
} from "./skillsSh";
export { parseSkillMarkdown } from "./parse";

export type InstallStatus = "new" | "installed" | "update-available";

/** Search a market provider for installable skills. */
export async function searchMarket(
  provider: "github" | "skills_sh",
  query: string,
  token?: string
): Promise<MarketSkillSummary[]> {
  if (provider === "skills_sh") return searchSkillsSh(query);
  const ref = parseRepoRef(query);
  if (!ref) throw new Error("Enter a repository as owner/repo");
  return listRepoSkills(ref, token);
}

/** Resolve a listing into installable content via the right provider. */
export async function resolveMarketSkill(
  summary: MarketSkillSummary,
  token?: string
): Promise<MarketSkillDetail> {
  if (summary.provider === "skills_sh") {
    return resolveSkillsShSkill(summary, token);
  }
  return resolveGithubSkill(summary, token);
}

/** Find an already-installed skill matching this market listing, if any. */
export function findInstalled(
  skills: Skill[],
  summary: Pick<MarketSkillSummary, "source"> & { skillPath?: string; name: string }
): Skill | undefined {
  return skills.find(
    (s) =>
      s.sourceType === "github" &&
      s.source === summary.source &&
      (summary.skillPath
        ? s.skillPath === summary.skillPath
        : s.name === summary.name)
  );
}

/** Classify a resolved skill against the current library. */
export function installStatus(
  skills: Skill[],
  detail: MarketSkillDetail
): { status: InstallStatus; existing?: Skill } {
  const existing = findInstalled(skills, {
    source: detail.source,
    skillPath: detail.skillPath,
    name: detail.name,
  });
  if (!existing) return { status: "new" };
  if (existing.installedHash && existing.installedHash !== detail.hash) {
    return { status: "update-available", existing };
  }
  return { status: "installed", existing };
}

/** Build the stored-skill payload from a resolved market skill.
 *
 * When `existing` is provided (an update / reinstall), user-owned fields
 * (tags, enabled, agent targets, sync mode) are preserved; only the
 * source-derived fields are refreshed. */
export function toSkillPayload(
  detail: MarketSkillDetail,
  existing?: Skill
): Omit<Skill, "id" | "createdAt" | "updatedAt"> {
  return {
    name: detail.name,
    description: detail.description,
    content: detail.content,
    tags: existing?.tags ?? [],
    enabled: existing?.enabled ?? true,
    agentKeys: existing?.agentKeys ?? [],
    syncMode: existing?.syncMode ?? "copy",
    sourceType: "github",
    source: detail.source,
    skillPath: detail.skillPath,
    sourceRef: detail.ref,
    installedHash: detail.hash,
    installs: detail.installs,
    files: detail.files,
    requires: detail.requires,
  };
}

/** Reconstruct a market listing from an installed github skill. */
export function summaryFromSkill(skill: Skill): MarketSkillSummary | null {
  if (skill.sourceType !== "github" || !skill.source) return null;
  return {
    id: `${skill.source}/${skill.name}`,
    name: skill.name,
    source: skill.source,
    skillPath: skill.skillPath,
    ref: skill.sourceRef,
    description: skill.description,
    installs: skill.installs,
    provider: "github",
  };
}

export type UpdateState = "up-to-date" | "update-available" | "error";

export interface SkillUpdateCheck {
  skill: Skill;
  state: UpdateState;
  detail?: MarketSkillDetail;
  error?: string;
}

/** Re-resolve an installed github skill and compare against its stored hash. */
export async function checkSkillUpdate(
  skill: Skill,
  token?: string
): Promise<SkillUpdateCheck> {
  const summary = summaryFromSkill(skill);
  if (!summary) {
    return { skill, state: "error", error: "Not a market skill" };
  }
  try {
    const detail = await resolveMarketSkill(summary, token);
    const changed =
      !skill.installedHash || skill.installedHash !== detail.hash;
    return {
      skill,
      state: changed ? "update-available" : "up-to-date",
      detail,
    };
  } catch (e) {
    return {
      skill,
      state: "error",
      error: e instanceof Error ? e.message : "Update check failed",
    };
  }
}
