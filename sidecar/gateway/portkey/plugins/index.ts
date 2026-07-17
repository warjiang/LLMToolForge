/**
 * Plugin (guardrails) registry stub for the LLMToolForge gateway sidecar.
 *
 * The upstream Portkey gateway ships a large `plugins/` tree of guardrail
 * integrations (many pulling in third-party SDKs). LLMToolForge does not expose
 * guardrails, so we replace it with an empty registry. The hooks middleware only
 * dereferences `plugins[source][fn]` when a request actually configures
 * before/after hooks, which never happens here, so an empty object is safe.
 */
export const plugins: Record<string, Record<string, unknown>> = {};

export default plugins;
