/**
 * Build a pi-ai `Model` from an exposed Unified-gateway model.
 *
 * The Unified gateway (`http://127.0.0.1:<port>/v1`) speaks both the OpenAI
 * Chat Completions and Responses protocols. Almost every routed model uses
 * `openai-completions`; the sole exception is the exact upstream model id
 * `gpt-6-astra` when function tools are present — it rejects tool turns on
 * `/v1/chat/completions` and must use `/v1/responses` (see
 * `resolveToolTransport`). The public model id is `{connName}/{model}`.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { ExposedModel } from "@/lib/unifiedApi";

export const UNIFIED_PROVIDER_ID = "unified";

/** Pi API transports the Unified runtime can select per run. */
export type ModelTransport = "openai-completions" | "openai-responses";

/**
 * Select the Pi API for a run. Responses is chosen only for the exact upstream
 * model id `gpt-6-astra` when resolved function tools are present; every other
 * case keeps Chat Completions. Match the upstream `realModel`, not the
 * connection-prefixed exposed id, and not a prefix/suffix/case variant.
 *
 * This is a deliberately narrow application policy, not a claim that all
 * providers serving that name implement Responses. A failing connection reports
 * an actionable error; this release does not learn exceptions or fall back to
 * reasoning-off.
 */
export function resolveToolTransport(
  realModel: string,
  hasTools: boolean
): ModelTransport {
  return hasTools && realModel === "gpt-6-astra"
    ? "openai-responses"
    : "openai-completions";
}

/** Fallbacks when the gateway model has no capability metadata. */
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 8_192;

export interface BuildPiModelOptions {
  /** Gateway base URL, e.g. `http://127.0.0.1:4141/v1`. */
  baseUrl: string;
  contextWindow?: number;
  maxTokens?: number;
  /**
   * Pi API this model uses for the run. Defaults to `openai-completions`.
   * The runtime selects `openai-responses` via {@link resolveToolTransport}
   * only for `gpt-6-astra` tool turns. The exposed id stays in the wire request
   * regardless, so the gateway performs normal connection routing/auth.
   */
  transport?: ModelTransport;
}

export function buildPiModel(
  exposed: ExposedModel,
  options: BuildPiModelOptions
): Model<ModelTransport> {
  const supportsVision = exposed.features.includes("vision");
  const input: ("text" | "image")[] = supportsVision
    ? ["text", "image"]
    : ["text"];

  return {
    id: exposed.id,
    name: exposed.id,
    api: options.transport ?? "openai-completions",
    provider: UNIFIED_PROVIDER_ID,
    baseUrl: options.baseUrl,
    // Keep this false: pi-ai parses upstream `reasoning_content` into thinking
    // blocks unconditionally (so reasoning still surfaces), while enabling it
    // would switch the system prompt to the OpenAI `developer` role, which many
    // upstreams behind the gateway reject (400 invalid role). For the Responses
    // path, reasoning replay is requested via the provider's onPayload hook
    // (include: reasoning.encrypted_content), NOT by flipping this to true —
    // which would instead inject `reasoning.effort: "none"`.
    reasoning: false,
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: options.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
  };
}

/** True when the exposed model can route function/tool calls. */
export function supportsFunctionCall(exposed: ExposedModel): boolean {
  return exposed.features.includes("function-call");
}
