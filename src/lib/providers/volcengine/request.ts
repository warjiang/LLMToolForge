import { httpFetch } from "@/lib/http";
import type { ProviderCredential } from "@/lib/providers/types";

const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

export function baseUrl(cred: ProviderCredential): string {
  return (cred.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export function requireArkApiKey(cred: ProviderCredential): string {
  if (!cred.apiKey) throw new Error("缺少 Ark API Key");
  return cred.apiKey;
}

export async function postArkJson(
  cred: ProviderCredential,
  path: string,
  body: unknown,
  signal?: AbortSignal
): Promise<Response> {
  return httpFetch(`${baseUrl(cred)}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireArkApiKey(cred)}`,
    },
    body: JSON.stringify(body),
    signal,
  });
}

export async function getArkJson(
  cred: ProviderCredential,
  path: string,
  signal?: AbortSignal
): Promise<Response> {
  return httpFetch(`${baseUrl(cred)}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${requireArkApiKey(cred)}`,
    },
    signal,
  });
}

export async function ensureOk(res: Response, label: string) {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${label} 失败: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
}
