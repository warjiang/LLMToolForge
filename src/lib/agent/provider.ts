/**
 * pi-ai provider + stream function for the local Unified gateway.
 *
 * The gateway is OpenAI-compatible on both `/v1/chat/completions` and
 * `/v1/responses`. We register a single dynamic provider (`unified`) whose API
 * is selected per runtime: Chat Completions by default, or Responses for the
 * `gpt-6-astra` tool path (see `resolveToolTransport` in `./model`). Auth is a
 * static local bearer key (optional). The returned `streamFn` satisfies Pi's
 * `StreamFn` contract and is handed to the `Agent`.
 */

import {
  createModels,
  createProvider,
  type ApiKeyAuth,
  type AuthResult,
  type Model,
  type MutableModels,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { UNIFIED_PROVIDER_ID, type ModelTransport } from "./model";

/** Gateway accepts any non-empty bearer when no local key is configured. */
const FALLBACK_LOCAL_KEY = "sk-unified-local";

function unifiedApiKeyAuth(localKey: string): ApiKeyAuth {
  const key = localKey.trim() || FALLBACK_LOCAL_KEY;
  return {
    name: "Unified Gateway",
    resolve: async ({ model }): Promise<AuthResult> => ({
      auth: { apiKey: key, baseUrl: model.baseUrl },
      source: "unified-gateway",
    }),
  };
}

export interface UnifiedRuntime {
  models: MutableModels;
  streamFn: StreamFn;
}

/**
 * Merge stateless reasoning-replay state into a Responses payload without
 * selecting an effort level.
 *
 * The installed Pi Responses API only adds `reasoning`/`include` when
 * `model.reasoning` is truthy. We keep `model.reasoning: false` (so no
 * `reasoning.effort` is injected) and instead request the upstream's default
 * reasoning replay here: keep `store: false`, drop any `previous_response_id`,
 * and add `reasoning.encrypted_content` to `include` (merging, not replacing).
 * The upstream's own default effort is preserved.
 */
export function applyResponsesReplayPolicy(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const p = payload as Record<string, unknown>;

  // Stateless item replay only.
  p.store = false;
  delete (p as { previous_response_id?: unknown }).previous_response_id;

  // Merge encrypted-content replay into any existing include list.
  const include = new Set<string>(
    Array.isArray(p.include) ? (p.include as string[]) : []
  );
  include.add("reasoning.encrypted_content");
  p.include = [...include];

  return p;
}

/**
 * Create a Pi runtime bound to the Unified gateway.
 *
 * @param models    pi-ai `Model`s built via `buildPiModel` (all share `transport`).
 * @param baseUrl   gateway base URL (`http://127.0.0.1:<port>/v1`).
 * @param localKey  optional local bearer key.
 * @param transport Pi API for this runtime. `openai-responses` also installs
 *                  the reasoning-replay payload policy and disables SDK retries.
 */
export function createUnifiedRuntime(
  models: Model<ModelTransport>[],
  baseUrl: string,
  localKey: string,
  transport: ModelTransport = "openai-completions"
): UnifiedRuntime {
  const collection = createModels();
  collection.setProvider(
    createProvider({
      id: UNIFIED_PROVIDER_ID,
      name: "Unified Gateway",
      baseUrl,
      auth: { apiKey: unifiedApiKeyAuth(localKey) },
      models,
      api:
        transport === "openai-responses"
          ? openAIResponsesApi()
          : openAICompletionsApi(),
    })
  );

  const streamFn: StreamFn =
    transport === "openai-responses"
      ? (model, context, options) =>
          collection.streamSimple(model, context, {
            ...options,
            // Request stateless reasoning replay without an effort override.
            onPayload: applyResponsesReplayPolicy,
            // No automatic retries on the Responses path (design.md
            // "Failure Lifecycle: No Automatic Retry").
            maxRetries: 0,
          })
      : (model, context, options) =>
          collection.streamSimple(model, context, options);

  return { models: collection, streamFn };
}
