/**
 * Model listing for OpenAI-compatible gateways (new-api / litellm).
 *
 * Fetches `{baseUrl}/models` (OpenAI `GET /v1/models` shape) with a Bearer
 * API key and maps the result to normalized ModelInfo.
 */

import { httpFetch } from "@/lib/http";
import type { ModelInfo, ProviderCredential } from "@/lib/providers/types";

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
  if (!cred.baseUrl) throw new Error("缺少 Base URL");
  if (!cred.apiKey) throw new Error("缺少 API Key");
  const url = `${cred.baseUrl.replace(/\/+$/, "")}/models`;

  const res = await httpFetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${cred.apiKey}`,
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
