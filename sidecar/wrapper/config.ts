/**
 * Runtime configuration for the LLMToolForge gateway sidecar.
 *
 * The Tauri Rust supervisor writes a JSON config file and passes its path via
 * `--config=<path>` (or the `GATEWAY_CONFIG_FILE` env var). The file holds the
 * local API key and the routing table (exposed model id -> upstream). We load it
 * once at startup and watch it for changes so config updates from the app apply
 * without restarting the process.
 */

import { readFileSync, watch } from 'node:fs';

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
  } catch (err) {
    // Keep the last good config on transient read/parse errors (e.g. the
    // supervisor writing the file). Log to stderr for diagnostics.
    console.error(
      `[gateway] failed to load config from ${configPath}:`,
      (err as Error).message
    );
  }
}

/** Initialize config loading from the given path and start watching it. */
export function initConfig(path: string | undefined): void {
  configPath = path;
  if (!configPath) {
    current = EMPTY;
    return;
  }
  reload();
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    watch(configPath, () => {
      // Debounce rapid successive writes.
      if (timer) clearTimeout(timer);
      timer = setTimeout(reload, 100);
    });
  } catch (err) {
    console.error(
      `[gateway] cannot watch config ${configPath}:`,
      (err as Error).message
    );
  }
}

export function getConfig(): GatewayConfig {
  return current;
}

export function lookupRoute(exposedModel: string): RouteEntry | undefined {
  return current.routes[exposedModel];
}
