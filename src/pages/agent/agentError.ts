/**
 * Classification of raw agent/runtime error strings into stable i18n keys.
 *
 * Model calls stream from the local unified gateway through Tauri's plugin-http
 * shim (`src/lib/agent/gatewayFetch.ts`). When an upstream stream breaks
 * mid-flight, the failure historically surfaced verbatim as opaque strings the
 * user could not act on — most notably Tauri core's
 * `The resource id <n> is invalid.` (a dropped streaming body resource), plus
 * the underlying `socket connection was closed unexpectedly` /
 * `Failed to parse JSON` from the gateway. This module maps that family of raw
 * errors to a readable, localized message so the chat explains the real cause.
 *
 * Kept as a pure, `t`-free function so it can be unit-tested in isolation;
 * `normalizeAgentErrorMessage` in `AgentChatView.tsx` resolves the key via i18n.
 */

/** i18n key for an upstream stream that was interrupted / dropped. */
export const AGENT_ERR_UPSTREAM_INTERRUPTED = "agent_error_upstream_interrupted";
/** i18n key for an upstream response the gateway could not parse. */
export const AGENT_ERR_UPSTREAM_BAD_RESPONSE = "agent_error_upstream_bad_response";

/**
 * Return the i18n key describing a known gateway/stream failure, or `null` when
 * the raw string carries no recognized pattern (caller shows it as-is).
 */
export function classifyAgentError(raw: string): string | null {
  const msg = (raw ?? "").toLowerCase();
  if (!msg) return null;

  // Tauri core: a streaming body resource was dropped (the stream broke and the
  // next plugin-http read hit an already-freed resource id).
  if (/resource id\s+\d+\s+is invalid/.test(msg)) {
    return AGENT_ERR_UPSTREAM_INTERRUPTED;
  }
  // The upstream socket closed mid-stream (also emitted by the gateway's new
  // structured SSE error terminator, which forwards this raw message).
  if (msg.includes("socket connection was closed unexpectedly")) {
    return AGENT_ERR_UPSTREAM_INTERRUPTED;
  }
  if (msg.includes("connection was closed") || msg.includes("connection closed")) {
    return AGENT_ERR_UPSTREAM_INTERRUPTED;
  }
  // Portkey could not parse the upstream response body (empty / non-JSON).
  if (msg.includes("failed to parse json")) {
    return AGENT_ERR_UPSTREAM_BAD_RESPONSE;
  }
  return null;
}

export function normalizeAgentErrorMessage(
  raw: string,
  translate: (key: string) => string,
  classifyGatewayErrors: boolean,
): string {
  let message = (raw ?? "").trim();
  if (message.length >= 2) {
    const first = message[0];
    const last = message[message.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      message = message.slice(1, -1).trim();
    }
  }
  if (/^request cancell?ed$/i.test(message)) {
    return translate("agent_request_cancelled");
  }
  if (classifyGatewayErrors) {
    const key = classifyAgentError(message);
    if (key) return translate(key);
  }
  return message;
}
