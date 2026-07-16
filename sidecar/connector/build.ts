/**
 * Build the OpenConnector sidecar for LLMToolForge.
 *
 * OpenConnector (https://github.com/oomol-lab/open-connector, Apache-2.0) is
 * fetched at a pinned commit (see UPSTREAM.json) into `upstream/` (gitignored),
 * lightly patched for Bun compatibility, and compiled with `bun build
 * --compile` into a self-contained binary named for Tauri's `externalBin`
 * convention:
 *
 *   src-tauri/binaries/open-connector-<rust-target-triple>[.exe]
 *
 * The runtime also needs on-disk resources (generated provider catalog, SQL
 * migrations, built Web Console). Those are assembled into
 * `src-tauri/resources/connector/` and bundled via `bundle.resources`; the
 * Rust supervisor starts the binary with that directory as its cwd.
 *
 * Patches applied to the vendored tree (string-level, idempotent):
 *   1. `node:sqlite` -> local `bun:sqlite` shim (Bun has no `node:sqlite`).
 *   2. Migrations directory becomes overridable via
 *      `OOMOL_CONNECT_MIGRATIONS_DIR` (a compiled binary cannot read
 *      directories addressed relative to `import.meta.url`).
 *
 * Usage:
 *   bun run build.ts                        # fetch + build for the host triple
 *   bun run build.ts --target=<rust-triple> # cross-compile for another triple
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const upstreamDir = join(here, "upstream");
const upstream = JSON.parse(readFileSync(join(here, "UPSTREAM.json"), "utf8")) as {
  repo: string;
  commit: string;
};

const RUST_TO_BUN: Record<string, string> = {
  "aarch64-apple-darwin": "bun-darwin-arm64",
  "x86_64-apple-darwin": "bun-darwin-x64",
  "x86_64-unknown-linux-gnu": "bun-linux-x64",
  "aarch64-unknown-linux-gnu": "bun-linux-arm64",
  "x86_64-pc-windows-msvc": "bun-windows-x64",
};

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function hostTriple(): string {
  const probe = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  if (probe.status === 0 && probe.stdout) {
    const line = probe.stdout.split("\n").find((l) => l.startsWith("host:"));
    if (line) return line.slice("host:".length).trim();
  }
  const { platform, arch } = process;
  if (platform === "darwin") return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  if (platform === "linux") return arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
  if (platform === "win32") return "x86_64-pc-windows-msvc";
  throw new Error(`无法推断目标三元组：platform=${platform} arch=${arch}`);
}

function run(cmd: string, args: string[], cwd: string): void {
  console.error(`[connector] $ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`[connector] command failed with exit code ${result.status ?? "unknown"}`);
    process.exit(result.status ?? 1);
  }
}

/** Clone (or update) the pinned upstream commit into `upstream/`. */
function fetchUpstream(): void {
  const headFile = join(upstreamDir, ".git");
  if (existsSync(headFile)) {
    const current = spawnSync("git", ["rev-parse", "HEAD"], { cwd: upstreamDir, encoding: "utf8" });
    if (current.status === 0 && current.stdout.trim() === upstream.commit) {
      console.error(`[connector] upstream already at ${upstream.commit}`);
      return;
    }
    rmSync(upstreamDir, { recursive: true, force: true });
  }
  mkdirSync(upstreamDir, { recursive: true });
  run("git", ["init", "-q"], upstreamDir);
  run("git", ["remote", "add", "origin", upstream.repo], upstreamDir);
  run("git", ["fetch", "-q", "--depth=1", "origin", upstream.commit], upstreamDir);
  run("git", ["checkout", "-q", "FETCH_HEAD"], upstreamDir);
}

/** Apply the Bun-compatibility patches to the vendored tree. Idempotent. */
function applyPatches(): void {
  cpSync(
    join(here, "shim", "node-sqlite-shim.ts"),
    join(upstreamDir, "src", "server", "storage", "node-sqlite-shim.ts"),
  );

  const storePath = join(upstreamDir, "src", "server", "storage", "sqlite-runtime-store.ts");
  let store = readFileSync(storePath, "utf8");
  const sqliteImport = 'import { DatabaseSync } from "node:sqlite";';
  const shimImport = 'import { DatabaseSync } from "./node-sqlite-shim.ts";';
  if (store.includes(sqliteImport)) {
    store = store.replace(sqliteImport, shimImport);
  } else if (!store.includes(shimImport)) {
    throw new Error("[connector] 未找到 node:sqlite import，上游代码可能已变化，请更新补丁。");
  }

  const migrationsOrig = 'const migrationDirectory = new URL("../../../migrations/", import.meta.url);';
  const migrationsPatched = [
    "const migrationDirectory = process.env.OOMOL_CONNECT_MIGRATIONS_DIR",
    '  ? new URL(`file://${process.env.OOMOL_CONNECT_MIGRATIONS_DIR.replace(/\\/?$/, "/")}`)',
    '  : new URL("../../../migrations/", import.meta.url);',
  ].join("\n");
  if (store.includes(migrationsOrig)) {
    store = store.replace(migrationsOrig, migrationsPatched);
  } else if (!store.includes("OOMOL_CONNECT_MIGRATIONS_DIR")) {
    throw new Error("[connector] 未找到 migrations 目录定义，上游代码可能已变化，请更新补丁。");
  }
  writeFileSync(storePath, store);
}

function main(): void {
  const triple = arg("target") ?? hostTriple();
  const bunTarget = RUST_TO_BUN[triple];
  if (!bunTarget) {
    throw new Error(`不支持的目标三元组：${triple}。支持：${Object.keys(RUST_TO_BUN).join(", ")}`);
  }

  fetchUpstream();

  // `--ignore-scripts`: upstream postinstall runs its generators with `node`,
  // which fails on Node < 22.18 (no default type stripping); we run them with
  // bun explicitly below. `proxy-agent` is an optional runtime require of
  // urllib (via ali-oss) that must be resolvable for `bun build --compile`.
  run("bun", ["install", "--ignore-scripts"], upstreamDir);
  const pkg = JSON.parse(readFileSync(join(upstreamDir, "package.json"), "utf8"));
  if (!pkg.devDependencies?.["proxy-agent"]) {
    run("bun", ["add", "-d", "--ignore-scripts", "proxy-agent"], upstreamDir);
  }

  applyPatches();

  run("bun", ["scripts/generate-provider-registry.ts"], upstreamDir);
  run("bun", ["scripts/generate-catalog.ts"], upstreamDir);
  run("bun", ["run", "--cwd", "web", "build"], upstreamDir);

  // Compile the runtime binary.
  const binDir = resolve(arg("outdir") ?? join(repoRoot, "src-tauri", "binaries"));
  mkdirSync(binDir, { recursive: true });
  const ext = triple.includes("windows") ? ".exe" : "";
  const outFile = join(binDir, `open-connector-${triple}${ext}`);
  run(
    "bun",
    [
      "build",
      "--compile",
      "--minify",
      "--sourcemap=none",
      // pino would otherwise try to load the `pino-pretty` transport, which
      // cannot be resolved from inside a compiled binary.
      "--define",
      'process.env.NODE_ENV="production"',
      `--target=${bunTarget}`,
      "src/server/index.ts",
      `--outfile=${outFile}`,
    ],
    upstreamDir,
  );

  // Assemble runtime resources (read from cwd by the runtime).
  const resDir = join(repoRoot, "src-tauri", "resources", "connector");
  rmSync(resDir, { recursive: true, force: true });
  mkdirSync(resDir, { recursive: true });
  cpSync(join(upstreamDir, "catalog"), join(resDir, "catalog"), { recursive: true });
  cpSync(join(upstreamDir, "migrations"), join(resDir, "migrations"), { recursive: true });
  cpSync(join(upstreamDir, "dist", "web"), join(resDir, "dist", "web"), { recursive: true });
  writeFileSync(join(resDir, "UPSTREAM.json"), readFileSync(join(here, "UPSTREAM.json")));

  console.error(`[connector] binary   -> ${outFile}`);
  console.error(`[connector] resource -> ${resDir}`);
  console.error("[connector] done");
}

main();
