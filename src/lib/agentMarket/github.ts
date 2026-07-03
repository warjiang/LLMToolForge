/**
 * GitHub-backed external-agent source.
 *
 * Reuses the low-level GitHub plumbing from the Skills market (`skillMarket/
 * github.ts`) — repo-ref parsing, tree enumeration, directory download and the
 * stable content hash — to fetch a whole *agent package* directory (the folder
 * containing `agent.json`) from a GitHub repo. The downloaded file set is then
 * materialized to disk by the Rust `agent_write_package` command before the
 * normal manifest-read + env-build install flow runs.
 *
 * All network calls flow through `httpFetch`, so inside Tauri they're issued
 * from Rust and bypass WebView CORS.
 */

import {
  parseRepoRef,
  defaultBranch,
  fetchTree,
  fetchDirFiles,
  hashSkillFiles,
  type RepoRef,
} from "@/lib/skillMarket/github";
import type { SkillFile } from "@/types";

export interface AgentRepoRef extends RepoRef {
  /** Optional sub-directory (agent package folder) within the repo. */
  subdir?: string;
}

/**
 * Parse "owner/repo", "owner/repo@ref", "owner/repo/sub/dir", or a GitHub URL
 * (incl. `/tree/<ref>/sub/dir`) into an agent repo reference. Unlike the skill
 * `parseRepoRef`, this preserves a sub-directory so a single repo can host an
 * agent package under a folder.
 */
export function parseAgentRef(input: string): AgentRepoRef | null {
  const base = parseRepoRef(input);
  if (!base) return null;

  const text = input.trim();
  let subdir: string | undefined;

  // GitHub URL: capture the path after /tree/<ref>/.
  const urlMatch =
    /github\.com\/[^/]+\/[^/]+?(?:\.git)?(?:\/tree\/[^/]+\/(.+))?(?:\/)?$/i.exec(
      text
    );
  if (urlMatch && urlMatch[1]) {
    subdir = urlMatch[1];
  } else if (!/github\.com/i.test(text)) {
    // Shorthand: owner/repo/sub/dir[@ref] → everything past owner/repo is subdir.
    const withoutRef = text.includes("@")
      ? text.slice(0, text.lastIndexOf("@"))
      : text;
    const parts = withoutRef.split("/").filter(Boolean);
    if (parts.length > 2) {
      subdir = parts.slice(2).join("/");
    }
  }

  subdir = subdir?.replace(/^\/+|\/+$/g, "").trim() || undefined;
  return { ...base, subdir };
}

/** Manifest fields we surface from a downloaded `agent.json`. */
export interface AgentPackageManifest {
  id: string;
  name?: string;
  description?: string;
  runtime?: string;
  entry?: string;
  framework?: string;
  version?: string;
}

export interface ResolvedGithubAgent {
  /** `owner/repo`. */
  source: string;
  /** Resolved branch/tag/commit the files were fetched at. */
  ref: string;
  /** Package sub-directory within the repo (empty for repo root). */
  subdir: string;
  /** Downloaded files, paths relative to the package directory. */
  files: SkillFile[];
  /** Parsed `agent.json` fields. */
  manifest: AgentPackageManifest;
  /** Stable content hash over the whole package (for update detection). */
  hash: string;
  /** Count of files skipped by size/count limits (best-effort). */
  skippedFiles?: number;
}

/** Locate the agent-package directory (folder holding `agent.json`) in a tree. */
function resolvePackageDir(
  tree: { path: string; type: string }[],
  subdir?: string
): string {
  const manifests = tree
    .filter((e) => e.type === "blob" && /(^|\/)agent\.json$/i.test(e.path))
    .map((e) => e.path);

  if (subdir !== undefined && subdir !== "") {
    const want = `${subdir}/agent.json`;
    const hit = manifests.find((p) => p.toLowerCase() === want.toLowerCase());
    if (!hit) {
      throw new Error(`未在 ${subdir}/ 下找到 agent.json`);
    }
    return subdir;
  }

  if (manifests.length === 0) {
    throw new Error("仓库中未找到 agent.json（外部 agent 清单）");
  }
  // Prefer a root manifest; otherwise the shallowest path.
  manifests.sort(
    (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b)
  );
  return manifests[0].replace(/\/?agent\.json$/i, "");
}

function parseManifest(files: SkillFile[]): AgentPackageManifest {
  const file = files.find((f) => /^agent\.json$/i.test(f.path));
  if (!file) throw new Error("下载的 agent 包缺少 agent.json");
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(file.content) as Record<string, unknown>;
  } catch (e) {
    throw new Error(
      `解析 agent.json 失败：${e instanceof Error ? e.message : String(e)}`
    );
  }
  const str = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  const id = str(data.id);
  if (!id) throw new Error("agent.json 缺少 id");
  return {
    id,
    name: str(data.name),
    description: str(data.description),
    runtime: str(data.runtime),
    entry: str(data.entry),
    framework: str(data.framework),
    version: str(data.version),
  };
}

/**
 * Resolve a GitHub reference into a downloadable agent package: fetch the
 * package directory's files, parse its manifest and compute a content hash.
 */
export async function resolveGithubAgent(
  input: string,
  token?: string
): Promise<ResolvedGithubAgent> {
  const ref = parseAgentRef(input);
  if (!ref) {
    throw new Error("无法解析仓库地址（应为 owner/repo 或 GitHub URL）");
  }
  const branch = ref.ref || (await defaultBranch(ref.owner, ref.repo, token));
  const tree = await fetchTree(ref, branch, token);
  const pkgDir = resolvePackageDir(tree, ref.subdir);

  const collected = await fetchDirFiles(ref, branch, pkgDir, tree);
  if (!collected.files.some((f) => /^agent\.json$/i.test(f.path))) {
    throw new Error("下载的 agent 包缺少 agent.json");
  }

  const manifest = parseManifest(collected.files);
  const hash = await hashSkillFiles(collected.files);

  return {
    source: `${ref.owner}/${ref.repo}`,
    ref: branch,
    subdir: pkgDir,
    files: collected.files,
    manifest,
    hash,
    skippedFiles: collected.skipped || undefined,
  };
}
