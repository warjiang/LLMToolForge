/**
 * Call-log emission for the gateway sidecar.
 *
 * Each completed model call is written to stdout as a single line prefixed with
 * {@link LOG_MARKER}. The Tauri Rust supervisor reads the sidecar's stdout, picks
 * out these lines, assigns an id, stores them in its ring buffer and forwards
 * them to the frontend monitoring UI (live logs, success rate, P95, tokens).
 */

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

/** Bound a captured body so the ring buffer stays memory-safe. */
export function truncateBody(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  if (s.length <= MAX_BODY_CHARS) return s;
  return `${s.slice(0, MAX_BODY_CHARS)}…[truncated ${s.length - MAX_BODY_CHARS} chars]`;
}

export function emitCallLog(rec: CallLog): void {
  try {
    process.stdout.write(`${LOG_MARKER}${JSON.stringify(rec)}\n`);
  } catch {
    // Never let logging failures break a request.
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
