/**
 * Runtime configuration for the LLMToolForge gateway sidecar.
 *
 * The Tauri Rust supervisor writes a JSON config file and passes its path via
 * `--config=<path>` (or the `GATEWAY_CONFIG_FILE` env var). The file holds the
 * local API key and the routing table (exposed model id -> upstream). We load it
 * once at startup and watch it for changes so config updates from the app apply
 * without restarting the process.
 */

import { readFileSync, statSync, watch } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

/** One upstream an exposed model id routes to. */
export interface RouteEntry {
  /** App-side provider label (volcengine / new-api / litellm) — for logging. */
  provider: string;
  /** Portkey provider id used for translation. Defaults to `openai`. */
  portkeyProvider?: string;
  /** Upstream base URL including version segment, no trailing slash. */
  baseUrl: string;
  /** Upstream API key (never exposed to clients). */
  apiKey: string;
  /** Real model id understood by the upstream. */
  realModel: string;
}

export interface GatewayConfig {
  /** Optional local bearer key clients must present. Empty/undefined = no auth. */
  localKey?: string;
  /** exposedModel -> upstream. */
  routes: Record<string, RouteEntry>;
}

const EMPTY: GatewayConfig = { localKey: undefined, routes: {} };

let current: GatewayConfig = EMPTY;
let configPath: string | undefined;
let lastMtimeMs = -1;

function normalize(raw: any): GatewayConfig {
  const routes: Record<string, RouteEntry> = {};
  const src = raw?.routes ?? {};
  for (const [id, entry] of Object.entries<any>(src)) {
    if (!entry) continue;
    routes[id] = {
      provider: String(entry.provider ?? ''),
      portkeyProvider: entry.portkeyProvider
        ? String(entry.portkeyProvider)
        : undefined,
      baseUrl: String(entry.baseUrl ?? '').replace(/\/+$/, ''),
      apiKey: String(entry.apiKey ?? ''),
      realModel: String(entry.realModel ?? id),
    };
  }
  const localKey =
    typeof raw?.localKey === 'string' && raw.localKey.trim().length > 0
      ? raw.localKey.trim()
      : undefined;
  return { localKey, routes };
}

function reload(): void {
  if (!configPath) return;
  try {
    const text = readFileSync(configPath, 'utf-8');
    current = normalize(JSON.parse(text));
    lastMtimeMs = safeMtimeMs(configPath);
  } catch (err) {
    // Keep the last good config on transient read/parse errors (e.g. the
    // supervisor writing the file). Log to stderr for diagnostics.
    console.error(
      `[gateway] failed to load config from ${configPath}:`,
      (err as Error).message
    );
  }
}

/** Modification time in ms, or `-1` when the file is missing/unreadable. */
function safeMtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return -1;
  }
}

/** Initialize config loading from the given path and start watching it. */
export function initConfig(path: string | undefined): void {
  configPath = path ? resolve(path) : undefined;
  if (!configPath) {
    current = EMPTY;
    return;
  }
  reload();

  const dir = dirname(configPath);
  const base = basename(configPath);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(reload, 100);
  };

  // Watch the *directory*, not the file. The supervisor replaces the config
  // atomically (write `<name>.tmp` then rename over `<name>`); a file-level
  // `fs.watch` follows the now-deleted inode and silently stops delivering
  // events after the first replacement, leaving the routing table stale. A
  // directory watch survives renames because the directory inode is stable.
  try {
    watch(dir, (_event, filename) => {
      if (!filename || filename === base || filename === `${base}.tmp`) {
        schedule();
      }
    });
  } catch (err) {
    console.error(
      `[gateway] cannot watch config dir ${dir}:`,
      (err as Error).message
    );
  }

  // Belt-and-suspenders: poll the mtime so a dropped fs event (or a platform
  // with unreliable directory notifications) still converges to the latest
  // config without a restart.
  const poll = setInterval(() => {
    if (!configPath) return;
    const mtime = safeMtimeMs(configPath);
    if (mtime !== lastMtimeMs) reload();
  }, 1500);
  poll.unref?.();
}

export function getConfig(): GatewayConfig {
  return current;
}

export function lookupRoute(exposedModel: string): RouteEntry | undefined {
  return current.routes[exposedModel];
}
