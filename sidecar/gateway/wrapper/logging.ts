/**
 * Call-log emission for the gateway sidecar.
 *
 * Each completed model call is written to stdout as a single line prefixed with
 * {@link LOG_MARKER}. The Tauri Rust supervisor reads the sidecar's stdout, picks
 * out these lines, assigns an id, stores them in its ring buffer and forwards
 * them to the frontend monitoring UI (live logs, success rate, P95, tokens).
 *
 * In addition to the stdout stream, completed calls (and Portkey's own
 * diagnostic lines) are appended to a rolling per-day JSONL file under the app
 * config dir (`logs/gateway-YYYYMMDD.jsonl`). This on-disk log survives restarts
 * (the stdout ring buffer does not) and correlates Portkey diagnostics
 * (`retryRequest` / `tryTargetsRecursively`) with the call that produced them.
 * It is default-quiet: only failed calls (`status >= 400` or a non-null `error`)
 * are recorded unless `GATEWAY_LOG_ALL=1` is set.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { MAX_DIAGNOSTIC_CHARS } from './observability.ts';

/** Stdout line prefix identifying a structured call-log record. */
export const LOG_MARKER = '@@LLMTF_CALLLOG@@';

export interface CallLog {
  /** Epoch milliseconds when the call started. */
  ts: number;
  exposedModel: string;
  realModel: string;
  provider: string;
  /** `openai-chat` | `anthropic` | `openai-image` | `openai-embeddings` | ... */
  protocol: string;
  stream: boolean;
  status: number;
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  error?: string;
  userAgent?: string;
  /** Truncated upstream request body (the real model call). */
  requestBody?: string;
  /** Truncated upstream response body. */
  responseBody?: string;
}

/** Max characters retained per captured request/response body (~1 MB). */
export const MAX_BODY_CHARS = 1_000_000;
/** Maximum bytes retained in one active or rotated daily JSONL file. */
export const MAX_DISK_LOG_BYTES = 1_000_000;
/** Number of days daily JSONL files remain on disk. */
export const LOG_RETENTION_DAYS = 14;

/** Bound a captured body so the ring buffer stays memory-safe. */
export function truncateBody(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  if (s.length <= MAX_BODY_CHARS) return s;
  return `${s.slice(0, MAX_BODY_CHARS)}…[truncated ${s.length - MAX_BODY_CHARS} chars]`;
}

// --- rolling on-disk JSONL log ---------------------------------------------

/** Directory holding the rolling daily logs, or `undefined` until configured. */
let logDir: string | undefined;
/** Whether to log every call, not just failures. Set from `GATEWAY_LOG_ALL`. */
let logAll = false;
let lastCleanupDay: string | undefined;

/** Per-line record type in the JSONL log. */
type DiskLogLevel = 'call' | 'warn';

/**
 * Configure the on-disk log directory. Derived from the config file's directory
 * (the app config dir), so no extra sidecar argument is needed: logs land in
 * `<configDir>/logs/`. Best-effort — a failure here just disables disk logging.
 */
export function initDiskLog(configPath: string | undefined): void {
  logAll = process.env.GATEWAY_LOG_ALL === '1';
  logDir = undefined;
  lastCleanupDay = undefined;
  if (!configPath) return;
  try {
    const dir = join(dirname(configPath), 'logs');
    mkdirSync(dir, { recursive: true });
    logDir = dir;
    cleanupExpiredLogs(Date.now());
  } catch {
    logDir = undefined;
  }
}

/** `YYYYMMDD` in local time, for the daily log filename. */
function dayStamp(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function boundDiskText(value: string): string {
  if (value.length <= MAX_DIAGNOSTIC_CHARS) return value;
  const suffix = '...[truncated]';
  return `${value.slice(0, MAX_DIAGNOSTIC_CHARS - suffix.length)}${suffix}`;
}

function boundPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [
      key,
      typeof value === 'string' ? boundDiskText(value) : value,
    ])
  );
}

function cleanupExpiredLogs(nowMs: number): void {
  if (!logDir) return;
  const cutoff = nowMs - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
  try {
    for (const entry of readdirSync(logDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/^gateway-\d{8}(?:\.1)?\.jsonl$/.test(entry.name)) continue;
      const path = join(logDir, entry.name);
      if (statSync(path).mtimeMs < cutoff) rmSync(path, { force: true });
    }
    lastCleanupDay = dayStamp(new Date(nowMs));
  } catch {
    // Retention cleanup is best-effort.
  }
}

function rotateIfNeeded(file: string, backup: string, incomingBytes: number): boolean {
  if (incomingBytes > MAX_DISK_LOG_BYTES) return false;
  if (!existsSync(file)) return true;
  try {
    if (statSync(file).size + incomingBytes <= MAX_DISK_LOG_BYTES) return true;
    rmSync(backup, { force: true });
    renameSync(file, backup);
    return true;
  } catch {
    return false;
  }
}

/** Append one JSON line to today's log file. Never throws. */
function appendDiskLine(level: DiskLogLevel, payload: Record<string, unknown>): void {
  if (!logDir) return;
  try {
    const now = new Date();
    const stamp = dayStamp(now);
    if (lastCleanupDay !== stamp) cleanupExpiredLogs(now.getTime());
    const file = join(logDir, `gateway-${stamp}.jsonl`);
    const backup = join(logDir, `gateway-${stamp}.1.jsonl`);
    const line = `${JSON.stringify({ level, ...boundPayload(payload) })}\n`;
    const incomingBytes = Buffer.byteLength(line);
    if (!rotateIfNeeded(file, backup, incomingBytes)) return;
    appendFileSync(file, line);
  } catch {
    // Disk logging is diagnostic only; never let it break a request.
  }
}

/** True when a completed call should be persisted under the default-quiet rule. */
function shouldPersistCall(rec: CallLog): boolean {
  if (logAll) return true;
  return rec.status >= 400 || (rec.error !== undefined && rec.error !== null);
}

/**
 * Record a non-call diagnostic line (e.g. a Portkey `retryRequest` /
 * `tryTargetsRecursively` message the sidecar would otherwise only print to
 * stderr) so it correlates on disk with the surrounding call logs.
 */
export function emitDiagnostic(message: string): void {
  const trimmed = message.trim();
  if (!trimmed) return;
  appendDiskLine('warn', { ts: Date.now(), message: trimmed });
}

export function emitCallLog(rec: CallLog): void {
  try {
    process.stdout.write(`${LOG_MARKER}${JSON.stringify(rec)}\n`);
  } catch {
    // Never let logging failures break a request.
  }
  if (shouldPersistCall(rec)) {
    // Bodies can be large; keep them out of the compact daily log — the Rust
    // supervisor already persists full bodies per-call to `unified-bodies/`.
    const { requestBody: _req, responseBody: _resp, ...meta } = rec;
    appendDiskLine('call', meta);
  }
}

/** Extract OpenAI-style usage tokens from a parsed response body. */
export function usageFromJson(
  v: any
): { prompt?: number; completion?: number; total?: number } | undefined {
  const u = v?.usage;
  if (!u) return undefined;
  const prompt = typeof u.prompt_tokens === 'number' ? u.prompt_tokens : undefined;
  const completion =
    typeof u.completion_tokens === 'number' ? u.completion_tokens : undefined;
  const total = typeof u.total_tokens === 'number' ? u.total_tokens : undefined;
  if (prompt === undefined && completion === undefined && total === undefined) {
    return undefined;
  }
  return { prompt, completion, total };
}

/**
 * Incrementally parses an OpenAI SSE stream to capture `usage` when present,
 * so streamed calls can still report token counts.
 */
export class UsageParser {
  private buf = '';
  prompt?: number;
  completion?: number;
  total?: number;

  feed(chunk: string): void {
    this.buf += chunk;
    let idx: number;
    while ((idx = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const v = JSON.parse(data);
        const u = v?.usage;
        if (u && u !== null) {
          if (typeof u.prompt_tokens === 'number') this.prompt = u.prompt_tokens;
          if (typeof u.completion_tokens === 'number')
            this.completion = u.completion_tokens;
          if (typeof u.total_tokens === 'number') this.total = u.total_tokens;
        }
      } catch {
        // ignore partial / non-JSON frames
      }
    }
  }

  tokens(): { prompt?: number; completion?: number; total?: number } | undefined {
    if (
      this.prompt === undefined &&
      this.completion === undefined &&
      this.total === undefined
    ) {
      return undefined;
    }
    return { prompt: this.prompt, completion: this.completion, total: this.total };
  }
}
