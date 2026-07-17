/**
 * Compile the gateway sidecar into a self-contained binary with `bun build
 * --compile`, named for Tauri's `externalBin` convention:
 *
 *   src-tauri/binaries/portkey-gateway-<rust-target-triple>[.exe]
 *
 * Usage:
 *   bun run build.ts                       # install deps + compile for host triple
 *   bun run build.ts --target=<rust-triple># cross-compile for another triple
 *   bun run build.ts --outdir=<path>       # override the output directory
 *   bun run build.ts --skip-install        # skip `bun install` (deps already present)
 *
 * Tauri substitutes the running platform's target triple into the binary name
 * at bundle time, so each platform in the release matrix must produce its own
 * `portkey-gateway-<triple>` file before `tauri build` runs.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

/** Map a Rust target triple to the matching `bun build --compile --target`. */
const RUST_TO_BUN: Record<string, string> = {
  'aarch64-apple-darwin': 'bun-darwin-arm64',
  'x86_64-apple-darwin': 'bun-darwin-x64',
  'x86_64-unknown-linux-gnu': 'bun-linux-x64',
  'aarch64-unknown-linux-gnu': 'bun-linux-arm64',
  'x86_64-pc-windows-msvc': 'bun-windows-x64',
};

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

/** Detect the host Rust target triple, falling back to the current platform. */
function hostTriple(): string {
  const probe = spawnSync('rustc', ['-vV'], { encoding: 'utf8' });
  if (probe.status === 0 && probe.stdout) {
    const line = probe.stdout.split('\n').find((l) => l.startsWith('host:'));
    if (line) return line.slice('host:'.length).trim();
  }
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'darwin') return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  if (platform === 'linux') return arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
  if (platform === 'win32') return 'x86_64-pc-windows-msvc';
  throw new Error(`无法推断目标三元组：platform=${platform} arch=${arch}`);
}

const triple = arg('target') ?? hostTriple();
const bunTarget = RUST_TO_BUN[triple];
if (!bunTarget) {
  throw new Error(
    `不支持的目标三元组：${triple}。支持：${Object.keys(RUST_TO_BUN).join(', ')}`
  );
}

const outDir = resolve(arg('outdir') ?? join(repoRoot, 'src-tauri', 'binaries'));
mkdirSync(outDir, { recursive: true });

// Install dependencies first (triggers the patch-package postinstall that
// applies the vendored Portkey patches) so `bun run build.ts` is a
// self-contained build, symmetric with the connector sidecar.
if (!arg('skip-install')) {
  console.error('[build] installing dependencies');
  const install = spawnSync('bun', ['install', '--frozen-lockfile'], { cwd: here, stdio: 'inherit' });
  if (install.status !== 0) {
    console.error(`[build] bun install failed with exit code ${install.status ?? 'unknown'}`);
    process.exit(install.status ?? 1);
  }
}

const ext = triple.includes('windows') ? '.exe' : '';
const outFile = join(outDir, `portkey-gateway-${triple}${ext}`);

const cmd = [
  'build',
  '--compile',
  '--minify',
  '--sourcemap=none',
  `--target=${bunTarget}`,
  join(here, 'wrapper', 'gateway.ts'),
  `--outfile=${outFile}`,
];

console.error(`[build] compiling sidecar for ${triple} (${bunTarget})`);
console.error(`[build] -> ${outFile}`);

const result = spawnSync('bun', cmd, { cwd: here, stdio: 'inherit' });
if (result.status !== 0) {
  console.error(`[build] bun build failed with exit code ${result.status ?? 'unknown'}`);
  process.exit(result.status ?? 1);
}
console.error('[build] done');
