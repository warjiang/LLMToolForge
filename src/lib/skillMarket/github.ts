/**
 * GitHub-backed skill source.
 *
 * GitHub is the single source of truth for skill content: even market
 * providers such as skills.sh only act as a discovery index over GitHub repos.
 * This module knows how to enumerate the SKILL.md files in a repo and pull a
 * single skill's content.
 *
 * All network calls go through `httpFetch` so that, inside Tauri, requests are
 * issued from Rust and bypass WebView CORS restrictions.
 */

import { httpFetch } from "@/lib/http";
import { parseSkillMarkdown, parseSkillRequirements } from "./parse";
import type { MarketSkillDetail, MarketSkillSummary, SkillFile } from "@/types";

const GITHUB_API = "https://api.github.com";
const RAW_HOST = "https://raw.githubusercontent.com";

export interface RepoRef {
  owner: string;
  repo: string;
  ref?: string;
}

/** Parse "owner/repo", "owner/repo@ref" or a GitHub URL into a RepoRef. */
export function parseRepoRef(input: string): RepoRef | null {
  let text = input.trim();
  if (!text) return null;

  // Accept full GitHub URLs and extract owner/repo (+ optional /tree/<ref>).
  const urlMatch = /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+))?(?:\/.*)?$/i.exec(
    text
  );
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      ref: urlMatch[3] || undefined,
    };
  }

  let ref: string | undefined;
  const at = text.lastIndexOf("@");
  if (at > 0) {
    ref = text.slice(at + 1).trim() || undefined;
    text = text.slice(0, at).trim();
  }
  const parts = text.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts[0], repo: parts[1], ref };
}

function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function defaultBranch(
  owner: string,
  repo: string,
  token?: string
): Promise<string> {
  const res = await httpFetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    throw new Error(await describeGithubError(res, `${owner}/${repo}`));
  }
  const data = (await res.json()) as { default_branch?: string };
  return data.default_branch || "main";
}

async function describeGithubError(res: Response, what: string): Promise<string> {
  if (res.status === 404) return `Not found: ${what}`;
  if (res.status === 403 || res.status === 429) {
    return `GitHub rate limit reached. Add a token in settings to raise the limit.`;
  }
  let detail = "";
  try {
    const body = (await res.json()) as { message?: string };
    detail = body.message ? ` - ${body.message}` : "";
  } catch {
    /* ignore */
  }
  return `GitHub request failed (${res.status})${detail}`;
}

interface TreeEntry {
  path: string;
  type: string;
  size?: number;
}

/** Fetch a repo's full git tree (recursive). */
async function fetchTree(
  ref: RepoRef,
  branch: string,
  token?: string
): Promise<TreeEntry[]> {
  const res = await httpFetch(
    `${GITHUB_API}/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(
      branch
    )}?recursive=1`,
    { headers: authHeaders(token) }
  );
  if (!res.ok) {
    throw new Error(
      await describeGithubError(res, `${ref.owner}/${ref.repo}@${branch}`)
    );
  }
  const data = (await res.json()) as { tree?: TreeEntry[] };
  return data.tree ?? [];
}

/** List every SKILL.md in a repo as installable summaries. */
export async function listRepoSkills(
  ref: RepoRef,
  token?: string
): Promise<MarketSkillSummary[]> {
  const branch = ref.ref || (await defaultBranch(ref.owner, ref.repo, token));
  const tree = await fetchTree(ref, branch, token);
  const source = `${ref.owner}/${ref.repo}`;
  return tree
    .filter((e) => e.type === "blob" && /(^|\/)SKILL\.md$/i.test(e.path))
    .map((e) => {
      const dir = e.path.replace(/\/?SKILL\.md$/i, "");
      const name = dir ? dir.split("/").pop()! : ref.repo;
      return {
        id: `${source}/${name}`,
        name,
        source,
        skillPath: e.path,
        ref: branch,
        provider: "github" as const,
      };
    });
}

export async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Stable content hash over an entire skill file set. Files are sorted by path
 * and each is folded in as `path\u0000encoding\u0000content\u0000`, so any
 * change to any file (incl. references and scripts) changes the hash.
 */
export async function hashSkillFiles(files: SkillFile[]): Promise<string> {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const joined = sorted
    .map((f) => `${f.path}\u0000${f.encoding}\u0000${f.content}`)
    .join("\u0000");
  return sha256(joined);
}

async function fetchRaw(
  source: string,
  ref: string,
  path: string
): Promise<string | null> {
  const res = await httpFetch(
    `${RAW_HOST}/${source}/${encodeURIComponent(ref)}/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`
  );
  if (!res.ok) return null;
  return res.text();
}

// Limits to keep installs and the local store bounded.
const MAX_SKILL_FILES = 100;
const MAX_FILE_BYTES = 1.5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 6 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  "md", "markdown", "mdx", "txt", "rst", "json", "jsonc", "yaml", "yml",
  "toml", "ini", "cfg", "conf", "env", "sh", "bash", "zsh", "fish", "ps1",
  "py", "js", "mjs", "cjs", "ts", "tsx", "jsx", "css", "scss", "less",
  "html", "htm", "xml", "svg", "csv", "tsv", "sql", "rb", "go", "rs",
  "java", "kt", "c", "h", "cpp", "hpp", "cs", "php", "lua", "pl", "r",
  "gradle", "properties", "gitignore", "dockerfile", "makefile", "lock",
]);

function isTextFile(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  if (!base.includes(".")) return true; // extension-less files (LICENSE, etc.)
  const ext = base.split(".").pop()!.toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

async function arrayBufferToBase64(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Fetch every file inside a skill's directory (the folder containing
 * SKILL.md), returning them with paths relative to that directory. Text files
 * are kept as UTF-8; everything else is base64-encoded. Oversized or
 * over-count files are skipped and counted.
 */
async function fetchSkillFiles(
  ref: RepoRef,
  branch: string,
  skillDir: string,
  tree: TreeEntry[]
): Promise<{ files: SkillFile[]; skipped: number }> {
  const source = `${ref.owner}/${ref.repo}`;
  const prefix = skillDir ? `${skillDir}/` : "";
  const blobs = tree.filter(
    (e) => e.type === "blob" && (prefix === "" || e.path.startsWith(prefix))
  );

  const files: SkillFile[] = [];
  let skipped = 0;
  let total = 0;

  for (const entry of blobs) {
    if (files.length >= MAX_SKILL_FILES) {
      skipped += 1;
      continue;
    }
    if (typeof entry.size === "number" && entry.size > MAX_FILE_BYTES) {
      skipped += 1;
      continue;
    }
    const rel = entry.path.slice(prefix.length);
    if (!rel) continue;

    const url = `${RAW_HOST}/${source}/${encodeURIComponent(branch)}/${entry.path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    const res = await httpFetch(url);
    if (!res.ok) {
      skipped += 1;
      continue;
    }

    if (isTextFile(entry.path)) {
      const content = await res.text();
      total += content.length;
      if (total > MAX_TOTAL_BYTES) {
        skipped += 1;
        continue;
      }
      files.push({ path: rel, content, encoding: "utf8" });
    } else {
      const buf = await res.arrayBuffer();
      total += buf.byteLength;
      if (buf.byteLength > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) {
        skipped += 1;
        continue;
      }
      files.push({
        path: rel,
        content: await arrayBufferToBase64(buf),
        encoding: "base64",
      });
    }
  }

  return { files, skipped };
}

/**
 * Resolve the SKILL.md path for a skill whose folder name is `skillId` inside
 * a repo whose layout we don't know. Tries the common `skills/<id>/SKILL.md`
 * fast path, then falls back to scanning the repo tree.
 */
async function resolveSkillPath(
  ref: RepoRef,
  skillId: string,
  branch: string,
  token?: string
): Promise<string | null> {
  const fast = `skills/${skillId}/SKILL.md`;
  const probe = await fetchRaw(`${ref.owner}/${ref.repo}`, branch, fast);
  if (probe !== null) return fast;

  const all = await listRepoSkills({ ...ref, ref: branch }, token);
  const exact = all.find((s) => s.name === skillId);
  if (exact?.skillPath) return exact.skillPath;
  // Last resort: a path whose directory ends with the skill id.
  const loose = all.find((s) =>
    (s.skillPath ?? "").toLowerCase().includes(`/${skillId.toLowerCase()}/`)
  );
  return loose?.skillPath ?? null;
}

/** Fetch and resolve a single skill into an installable detail. */
export async function resolveGithubSkill(
  summary: MarketSkillSummary,
  token?: string
): Promise<MarketSkillDetail> {
  const [owner, repo] = summary.source.split("/");
  const repoRef: RepoRef = { owner, repo, ref: summary.ref };
  const branch = summary.ref || (await defaultBranch(owner, repo, token));

  let path = summary.skillPath;
  if (!path) {
    const skillId = summary.id.split("/").slice(2).join("/") || summary.name;
    path = (await resolveSkillPath(repoRef, skillId, branch, token)) ?? undefined;
  }
  if (!path) {
    throw new Error(`Could not locate SKILL.md for ${summary.id}`);
  }

  const raw = await fetchRaw(summary.source, branch, path);
  if (raw === null) {
    throw new Error(`Failed to download ${summary.source}/${path}`);
  }

  const parsed = parseSkillMarkdown(raw);
  let hash = await sha256(raw);
  const reqs = parseSkillRequirements(raw);

  // Collect sibling files (references, scripts, assets) for multi-file skills.
  const skillDir = path.replace(/\/?SKILL\.md$/i, "");
  let files: SkillFile[] | undefined;
  let skippedFiles: number | undefined;
  try {
    const tree = await fetchTree(repoRef, branch, token);
    const collected = await fetchSkillFiles(repoRef, branch, skillDir, tree);
    // Guarantee SKILL.md is present and matches the raw we already parsed.
    if (!collected.files.some((f) => /^SKILL\.md$/i.test(f.path))) {
      collected.files.unshift({ path: "SKILL.md", content: raw, encoding: "utf8" });
    }
    if (collected.files.length > 1) {
      files = collected.files;
      skippedFiles = collected.skipped || undefined;
      // Update detection spans the whole directory, not just SKILL.md.
      hash = await hashSkillFiles(collected.files);
    }
  } catch {
    // Multi-file collection is best-effort; fall back to single SKILL.md.
  }

  return {
    name: parsed.name || summary.name,
    description: parsed.description || summary.description || "",
    content: raw,
    source: summary.source,
    skillPath: path,
    ref: branch,
    hash,
    installs: summary.installs,
    provider: summary.provider,
    files,
    requires: reqs.bins?.length ? reqs : undefined,
    skippedFiles,
  };
}
