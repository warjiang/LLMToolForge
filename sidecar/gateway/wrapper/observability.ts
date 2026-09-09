/** Maximum size of one persisted diagnostic message. */
export const MAX_DIAGNOSTIC_CHARS = 4_096;

export type StreamOutcome =
  | "success"
  | "upstream_error"
  | "client_cancelled";

const DIAGNOSTIC_PREFIX =
  /^(?:\[gateway\]|retryRequest\b|tryTargetsRecursively\b|Error (?:during stream processing|parsing .*stream chunk)|Failed to (?:parse JSON|abort the writer|close the writer))/i;

const TRUNCATED_SUFFIX = "...[truncated]";

function redactCredentials(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [redacted]")
    .replace(
      /\b(api[-_ ]?key|token|authorization|password|secret)\b(\s*[:=]\s*)[^\s,;"']+/gi,
      "$1$2[redacted]",
    );
}

function truncateDiagnostic(value: string): string {
  if (value.length <= MAX_DIAGNOSTIC_CHARS) return value;
  return `${value.slice(0, MAX_DIAGNOSTIC_CHARS - TRUNCATED_SUFFIX.length)}${TRUNCATED_SUFFIX}`;
}

/**
 * Convert known gateway diagnostics into a bounded, redacted message.
 *
 * Only the first allowlisted label and Error objects are retained. Arbitrary
 * console arguments can contain request headers, response bodies, or raw model
 * chunks and must never be serialized into the persistent log.
 */
export function formatGatewayDiagnostic(args: unknown[]): string | null {
  const label = typeof args[0] === "string" ? args[0].trim() : "";
  if (!label || !DIAGNOSTIC_PREFIX.test(label)) return null;

  const details: string[] = [];
  for (const value of args.slice(1)) {
    if (typeof value === "string" && /^chunk\s*:/i.test(value.trim())) break;
    if (value instanceof Error) {
      details.push(`${value.name}: ${value.message}`);
    } else if (typeof value === "string" && value.trim()) {
      details.push(value.trim());
    }
  }
  const message = [label, ...details].join(" ");
  return truncateDiagnostic(redactCredentials(message));
}

export function streamLogStatus(
  upstreamStatus: number,
  outcome: StreamOutcome,
): number {
  switch (outcome) {
    case "success":
      return upstreamStatus;
    case "upstream_error":
      return 502;
    case "client_cancelled":
      return 499;
  }
}

// --- OpenAI Responses (/v1/responses) observation --------------------------
//
// The Responses protocol is a distinct wire format from Chat Completions: SSE
// frames are `event: <type>` + `data: {...}`, usage lives under
// `response.usage` (input_tokens/output_tokens/total_tokens), and terminal
// state is a semantic event (`response.completed` / `response.incomplete` /
// `response.failed` / `error`) rather than `[DONE]`. These helpers observe
// those frames without translating successful payloads.

/** Map an endpoint path to a monitor protocol label. */
export function protocolFor(path: string): string {
  if (path.includes("/chat/completions")) return "openai-chat";
  if (path.includes("/responses")) return "openai-responses";
  if (path.includes("/images/")) return "openai-image";
  if (path.includes("/embeddings")) return "openai-embeddings";
  if (path.includes("/completions")) return "openai-complete";
  return "openai";
}

/** Outcome of a Responses stream, derived from its terminal semantic event. */
export type ResponsesOutcome =
  | "success"
  | "incomplete"
  | "failed"
  | "truncated";

export interface ResponsesOutcomeResult {
  outcome: ResponsesOutcome;
  /** Human-readable diagnostic for non-success outcomes. */
  diagnostic?: string;
  /** Usage captured from the terminal event, if present. */
  tokens?: { prompt?: number; completion?: number; total?: number };
}

function tokensFromResponsesUsage(
  usage: any,
): { prompt?: number; completion?: number; total?: number } | undefined {
  if (!usage) return undefined;
  const prompt =
    typeof usage.input_tokens === "number" ? usage.input_tokens : undefined;
  const completion =
    typeof usage.output_tokens === "number" ? usage.output_tokens : undefined;
  const total =
    typeof usage.total_tokens === "number" ? usage.total_tokens : undefined;
  if (prompt === undefined && completion === undefined && total === undefined) {
    return undefined;
  }
  return { prompt, completion, total };
}

/**
 * Incrementally parse a Responses SSE stream to capture `response.usage` from
 * its terminal event. Tolerates arbitrary chunk boundaries. The latest terminal
 * usage wins (usage is per-response, not cumulative), so re-feeding an identical
 * terminal event does not double count.
 */
export class ResponsesUsageParser {
  private buf = "";
  prompt?: number;
  completion?: number;
  total?: number;

  feed(chunk: string): void {
    this.buf += chunk;
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const v = JSON.parse(data);
        const usage = v?.response?.usage ?? v?.usage;
        const t = tokensFromResponsesUsage(usage);
        if (t) {
          if (t.prompt !== undefined) this.prompt = t.prompt;
          if (t.completion !== undefined) this.completion = t.completion;
          if (t.total !== undefined) this.total = t.total;
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

/**
 * Classify a fully-observed Responses SSE body by its terminal semantic event.
 *
 * - `response.completed` -> success
 * - `response.incomplete` -> non-success, reason preserved (Pi keeps output-limit
 *    semantics; the monitor marks it non-success without disguising it as a
 *    network exception)
 * - `response.failed` / `error` -> upstream failure with diagnostic
 * - no terminal event before EOF -> truncation failure
 *
 * This never claims endpoint non-support from an ambiguous status; it only reads
 * what the stream explicitly emitted.
 */
export function classifyResponsesOutcome(body: string): ResponsesOutcomeResult {
  let result: ResponsesOutcomeResult = {
    outcome: "truncated",
    diagnostic: "Responses stream ended before a terminal response event",
  };
  let sawTerminal = false;

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    let v: any;
    try {
      v = JSON.parse(data);
    } catch {
      continue;
    }
    const type = v?.type;
    if (type === "response.completed") {
      sawTerminal = true;
      result = { outcome: "success", tokens: tokensFromResponsesUsage(v?.response?.usage) };
    } else if (type === "response.incomplete") {
      sawTerminal = true;
      const reason = v?.response?.incomplete_details?.reason ?? "unknown";
      result = {
        outcome: "incomplete",
        diagnostic: `Responses output incomplete: ${reason}`,
        tokens: tokensFromResponsesUsage(v?.response?.usage),
      };
    } else if (type === "response.failed") {
      sawTerminal = true;
      const err = v?.response?.error;
      const details = v?.response?.incomplete_details;
      const msg = err
        ? `${err.code || "unknown"}: ${err.message || "no message"}`
        : details?.reason
          ? `incomplete: ${details.reason}`
          : "Responses request failed";
      result = { outcome: "failed", diagnostic: msg };
    } else if (type === "error") {
      sawTerminal = true;
      const msg = `${v?.code ?? "error"}: ${v?.message ?? "Responses stream error"}`;
      result = { outcome: "failed", diagnostic: msg };
    }
  }

  // A later terminal event overrides earlier ones; but never overwrite a real
  // failure with a truncation default when no terminal was seen.
  if (!sawTerminal) {
    return {
      outcome: "truncated",
      diagnostic: "Responses stream ended before a terminal response event",
    };
  }
  return result;
}

/**
 * SSE error terminator for a Responses stream that broke after HTTP 200. The
 * installed Pi Responses parser treats a top-level `event: error` frame as a
 * thrown stream error, so the client surfaces the real cause instead of an
 * opaque torn-stream failure. Distinct from the OpenAI chat `data: {error}`
 * frame and the Anthropic `event: error` message frame.
 */
export function responsesStreamErrorFrames(message: string): string[] {
  const payload = JSON.stringify({
    type: "error",
    code: "upstream_stream_error",
    message,
  });
  return [`event: error\ndata: ${payload}\n\n`];
}
