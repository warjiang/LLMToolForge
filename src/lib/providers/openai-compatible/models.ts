/**
 * Model listing for OpenAI-compatible gateways (new-api / litellm).
 *
 * Fetches `{baseUrl}/models` (OpenAI `GET /v1/models` shape) with a Bearer
 * API key and maps the result to normalized ModelInfo.
 */

import type { ModelInfo, ProviderCredential } from "@/lib/providers/types";
import {
  authHeader,
  endpoint,
  gatewayFetch,
  normalizeBaseUrl,
} from "./request";

interface OpenAIModel {
  id?: string;
  object?: string;
  owned_by?: string;
}

interface ModelListResponse {
  data?: OpenAIModel[];
}

export async function listModels(
  provider: string,
  cred: ProviderCredential
): Promise<ModelInfo[]> {
  const base = normalizeBaseUrl(cred);
  const authorization = authHeader(cred);
  const url = endpoint(base, "models");

  const res = await gatewayFetch(url, {
    method: "GET",
    headers: {
      Authorization: authorization,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`拉取模型失败: HTTP ${res.status} ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as ModelListResponse;
  const items = json?.data ?? [];
  return items
    .filter((m) => m.id)
    .map((m) => ({
      id: m.id as string,
      name: m.id as string,
      provider,
      tags: m.owned_by ? [m.owned_by] : undefined,
      raw: m,
    }));
}
