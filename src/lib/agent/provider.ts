/**
 * pi-ai provider + stream function for the local Unified gateway.
 *
 * The gateway is OpenAI-compatible, so we register a single dynamic provider
 * (`unified`) whose models all use the `openai-completions` API. Auth is a
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
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { UNIFIED_PROVIDER_ID } from "./model";

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
 * Create a Pi runtime bound to the Unified gateway.
 *
 * @param models   pi-ai `Model`s built via `buildPiModel`.
 * @param baseUrl  gateway base URL (`http://127.0.0.1:<port>/v1`).
 * @param localKey optional local bearer key.
 */
export function createUnifiedRuntime(
  models: Model<"openai-completions">[],
  baseUrl: string,
  localKey: string
): UnifiedRuntime {
  const collection = createModels();
  collection.setProvider(
    createProvider({
      id: UNIFIED_PROVIDER_ID,
      name: "Unified Gateway",
      baseUrl,
      auth: { apiKey: unifiedApiKeyAuth(localKey) },
      models,
      api: openAICompletionsApi(),
    })
  );

  const streamFn: StreamFn = (model, context, options) =>
    collection.streamSimple(model, context, options);

  return { models: collection, streamFn };
}
