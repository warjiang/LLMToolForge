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
