import type { ProviderAdapter } from "./types";
import { volcengineAdapter } from "./volcengine";

/** Registry of available provider adapters, keyed by provider id. */
export const PROVIDER_ADAPTERS: Record<string, ProviderAdapter> = {
  volcengine: volcengineAdapter,
};

export function getAdapter(provider: string): ProviderAdapter | undefined {
  return PROVIDER_ADAPTERS[provider];
}

export * from "./types";
