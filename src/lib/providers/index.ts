import type { ProviderAdapter } from "./types";
import { volcengineAdapter } from "./volcengine";
import { createOpenAICompatibleAdapter } from "./openai-compatible";

/** Registry of available provider adapters, keyed by provider id. */
export const PROVIDER_ADAPTERS: Record<string, ProviderAdapter> = {
  volcengine: volcengineAdapter,
  "new-api": createOpenAICompatibleAdapter("new-api"),
  litellm: createOpenAICompatibleAdapter("litellm"),
  dmxapi: createOpenAICompatibleAdapter("dmxapi"),
};

export function getAdapter(provider: string): ProviderAdapter | undefined {
  return PROVIDER_ADAPTERS[provider];
}

export * from "./types";
