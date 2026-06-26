/**
 * skills.sh market provider.
 *
 * skills.sh (https://www.skills.sh) is a discovery index over public skills.
 * For installable, GitHub-backed listings we prefer skills.sh's own
 * `/api/download/{owner}/{repo}/{slug}` endpoint, which returns the exact file
 * set (multi-file included) the same way `npx skills add` does. When that is
 * unavailable we fall back to crawling GitHub directly.
 *
 * Some listings point at vendor-hosted sources (e.g. `open.feishu.cn`) that
 * have no `owner/repo` and therefore cannot be downloaded through this
 * pipeline. Those surface a clear, actionable error instead of a confusing
 * GitHub 404.
 */

import { httpFetch } from "@/lib/http";
import { hashSkillFiles, resolveGithubSkill, sha256 } from "./github";
import { parseSkillMarkdown, parseSkillRequirements } from "./parse";
import type { MarketSkillDetail, MarketSkillSummary, SkillFile } from "@/types";

const SEARCH_ENDPOINT = "https://www.skills.sh/api/search";
const DOWNLOAD_ENDPOINT = "https://www.skills.sh/api/download";

interface SkillsShEntry {
  id: string;
  skillId?: string;
  name?: string;
  installs?: number;
  source?: string;
  description?: string;
}

/**
 * A market listing whose source is not a GitHub `owner/repo` (e.g. a vendor
 * marketplace such as `open.feishu.cn`). Such skills cannot be installed
 * through the GitHub-backed pipeline.
 */
export class UnsupportedSkillSourceError extends Error {
  constructor(public readonly host: string) {
    super(`Skill source "${host}" is not installable from a GitHub source.`);
    this.name = "UnsupportedSkillSourceError";
  }
}

/** Search skills.sh for installable skills. Requires a query of >= 2 chars. */
export async function searchSkillsSh(
  query: string
): Promise<MarketSkillSummary[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const res = await httpFetch(`${SEARCH_ENDPOINT}?q=${encodeURIComponent(q)}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`skills.sh search failed (${res.status})`);
  }
  const data = (await res.json()) as { skills?: SkillsShEntry[] };
  const skills = data.skills ?? [];
  return skills
    .filter((s) => s.source && isGithubBackedSource(s.source))
    .map((s) => {
      const skillId = s.skillId || s.id.split("/").slice(2).join("/");
      return {
        id: s.id,
        name: s.name || skillId || s.id,
        source: s.source!,
        ref: undefined,
        description: s.description,
        installs: s.installs,
        provider: "skills_sh" as const,
      } satisfies MarketSkillSummary;
    });
}

/** Split a skills.sh source ("owner/repo") into its GitHub parts. */
function githubSource(source: string): { owner: string; repo: string } | null {
  const parts = source.split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

/**
 * Whether a market source resolves to an installable GitHub `owner/repo`.
 * Vendor-hosted listings (e.g. `open.feishu.cn`) return false: skills.sh only
 * indexes them for discovery and exposes no downloadable files.
 */
export function isGithubBackedSource(source: string): boolean {
  return githubSource(source) !== null;
}

/** Derive a skill slug from a listing id by stripping its source prefix. */
function slugFromId(id: string, source: string): string {
  if (id.startsWith(`${source}/`)) return id.slice(source.length + 1);
  return id.split("/").pop() ?? id;
}

interface DownloadResponse {
  files?: { path: string; contents: string }[];
  hash?: string;
  error?: string;
}

/**
 * Resolve a listing via skills.sh's official download endpoint. Returns null
 * when the source is not GitHub-backed or the endpoint can't serve the skill,
 * so callers can fall back to a direct GitHub crawl.
 */
async function downloadSkillsShSkill(
  summary: MarketSkillSummary
): Promise<MarketSkillDetail | null> {
  const gh = githubSource(summary.source);
  if (!gh) return null;

  const slug = slugFromId(summary.id, summary.source);
  const url = `${DOWNLOAD_ENDPOINT}/${encodeURIComponent(
    gh.owner
  )}/${encodeURIComponent(gh.repo)}/${encodeURIComponent(slug)}`;

  const res = await httpFetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;

  let data: DownloadResponse;
  try {
    data = (await res.json()) as DownloadResponse;
  } catch {
    return null;
  }
  if (data.error || !data.files?.length) return null;

  const files: SkillFile[] = data.files.map((f) => ({
    path: f.path,
    content: f.contents,
    encoding: "utf8" as const,
  }));
  const skillMd =
    files.find((f) => /^SKILL\.md$/i.test(f.path)) ??
    files.find((f) => /(^|\/)SKILL\.md$/i.test(f.path));
  if (!skillMd) return null;

  const parsed = parseSkillMarkdown(skillMd.content);
  const reqs = parseSkillRequirements(skillMd.content);
  // Hash the same way the GitHub crawl does so update detection stays stable
  // regardless of which resolution path produced the install.
  const hash =
    files.length > 1
      ? await hashSkillFiles(files)
      : await sha256(skillMd.content);

  return {
    name: parsed.name || summary.name,
    description: parsed.description || summary.description || "",
    content: skillMd.content,
    source: summary.source,
    skillPath: skillMd.path,
    ref: summary.ref || "main",
    hash,
    installs: summary.installs,
    provider: "skills_sh",
    files: files.length > 1 ? files : undefined,
    requires: reqs.bins?.length ? reqs : undefined,
  };
}

/** Resolve a skills.sh listing into installable content. */
export async function resolveSkillsShSkill(
  summary: MarketSkillSummary,
  token?: string
): Promise<MarketSkillDetail> {
  const viaDownload = await downloadSkillsShSkill(summary);
  if (viaDownload) return viaDownload;

  // Fall back to a direct GitHub crawl when the source is a real owner/repo.
  if (githubSource(summary.source)) {
    const detail = await resolveGithubSkill(
      { ...summary, provider: "github" },
      token
    );
    return { ...detail, provider: "skills_sh", installs: summary.installs };
  }

  // Vendor-hosted (e.g. open.feishu.cn): nothing to install from GitHub.
  throw new UnsupportedSkillSourceError(summary.source);
}
