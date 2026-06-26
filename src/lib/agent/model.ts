/**
 * Build a pi-ai `Model` from an exposed Unified-gateway model.
 *
 * The Unified gateway (`http://127.0.0.1:<port>/v1`) speaks the OpenAI
 * Chat Completions protocol, so every routed model uses the
 * `openai-completions` API. The public model id is `{connName}/{model}`.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { ExposedModel } from "@/lib/unifiedApi";

export const UNIFIED_PROVIDER_ID = "unified";

/** Fallbacks when the gateway model has no capability metadata. */
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 8_192;

export interface BuildPiModelOptions {
  /** Gateway base URL, e.g. `http://127.0.0.1:4141/v1`. */
  baseUrl: string;
  contextWindow?: number;
  maxTokens?: number;
}

export function buildPiModel(
  exposed: ExposedModel,
  options: BuildPiModelOptions
): Model<"openai-completions"> {
  const supportsVision = exposed.features.includes("vision");
  const input: ("text" | "image")[] = supportsVision
    ? ["text", "image"]
    : ["text"];

  return {
    id: exposed.id,
    name: exposed.id,
    api: "openai-completions",
    provider: UNIFIED_PROVIDER_ID,
    baseUrl: options.baseUrl,
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
