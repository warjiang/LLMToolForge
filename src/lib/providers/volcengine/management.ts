/**
 * Volcengine Ark management API client.
 *
 * Uses AK/SK HMAC-SHA256 signing to call the OpenAPI gateway at
 * open.volcengineapi.com (service "ark", version "2024-01-01"). Surfaces the
 * account's deployed model endpoints and Ark API keys.
 */

import { httpFetch } from "@/lib/http";
import i18n from "@/i18n/config";
import { signVolcRequest } from "@/lib/volc/sign";
import type { ModelInfo } from "@/lib/providers/types";
import { lookupCatalog } from "./catalog";

const MGMT_HOST = "open.volcengineapi.com";
const SERVICE = "ark";
const VERSION = "2024-01-01";
const DEFAULT_REGION = "cn-beijing";
const DEFAULT_PROJECT = "default";

export interface VolcAkSk {
  accessKey: string;
  secretKey: string;
  region?: string;
  /** Ark project name; required by ListApiKeys. Defaults to "default". */
  project?: string;
}

interface ArkResponse<T> {
  Result?: T;
  ResponseMetadata?: {
    RequestId?: string;
    Error?: { Code?: string; Message?: string };
  };
}

/** Low-level signed POST to the Ark management gateway. */
async function callArk<T>(
  action: string,
  body: Record<string, unknown>,
  cred: VolcAkSk
): Promise<T> {
  const bodyStr = JSON.stringify(body ?? {});
  const region = cred.region || DEFAULT_REGION;
  const { url, headers } = await signVolcRequest({
    method: "POST",
    host: MGMT_HOST,
    path: "/",
    query: { Action: action, Version: VERSION },
    body: bodyStr,
    accessKey: cred.accessKey,
    secretKey: cred.secretKey,
    service: SERVICE,
    region,
  });

  const res = await httpFetch(url, {
    method: "POST",
    headers,
    body: bodyStr,
  });

  const text = await res.text();
  let json: ArkResponse<T>;
  try {
    json = JSON.parse(text) as ArkResponse<T>;
  } catch {
    throw new Error(
      i18n.t("provider_ark_non_json", {
        ns: "common",
        action,
        status: res.status,
        text: text.slice(0, 200),
      })
    );
  }

  const err = json.ResponseMetadata?.Error;
  if (err?.Code) {
    throw new Error(
      i18n.t("provider_ark_failed_code", {
        ns: "common",
        action,
        code: err.Code,
        message: err.Message ?? "",
      })
    );
  }
  if (!res.ok) {
    throw new Error(i18n.t("provider_ark_failed_http", { ns: "common", action, status: res.status }));
  }
  return json.Result as T;
}

// ---- Endpoints (deployed models) ----

interface FoundationModelRef {
  Name?: string;
  ModelVersion?: string;
}

interface EndpointItem {
  Id?: string;
  Name?: string;
  Status?: string;
  EndpointModelType?: string;
  ModelReference?: {
    FoundationModel?: FoundationModelRef;
    CustomModelId?: string | null;
  };
}

interface ListEndpointsResult {
  Items?: EndpointItem[];
  TotalCount?: number;
  PageNumber?: number;
  PageSize?: number;
}

/** Fetch all deployed endpoints, mapped to normalized ModelInfo. */
export async function listEndpoints(cred: VolcAkSk): Promise<ModelInfo[]> {
  const project = cred.project || DEFAULT_PROJECT;
  const out: ModelInfo[] = [];
  let page = 1;
  const pageSize = 100;
  // Paginate defensively.
  for (let i = 0; i < 50; i++) {
    const result = await callArk<ListEndpointsResult>(
      "ListEndpoints",
      { PageNumber: page, PageSize: pageSize, ProjectName: project },
      cred
    );
    const items = result?.Items ?? [];
    for (const item of items) {
      out.push(endpointToModel(item));
    }
    const total = result?.TotalCount ?? out.length;
    if (out.length >= total || items.length === 0) break;
    page += 1;
  }
  return out;
}

function endpointToModel(item: EndpointItem): ModelInfo {
  const fm = item.ModelReference?.FoundationModel;
  const fmName = fm?.Name;
  const lookupName = fmName ?? item.Id ?? item.Name;
  const cat = lookupCatalog(lookupName);
  const versionSuffix = fm?.ModelVersion ? ` (${fm.ModelVersion})` : "";
  const displayName =
    item.Name ||
    (fmName ? `${cat?.label ?? fmName}${versionSuffix}` : item.Id) ||
    item.Id ||
    "endpoint";

  return {
    id: item.Id ?? fmName ?? "",
    name: displayName,
    provider: "volcengine",
    contextWindow: cat?.contextWindow,
    supportsFunctionCall: cat?.supportsFunctionCall,
    supportsVision: cat?.supportsVision,
    supportsImageGeneration: cat?.supportsImageGeneration,
    supportsVideoGeneration: cat?.supportsVideoGeneration,
    inputModalities:
      cat?.inputModalities ?? (cat?.supportsVision ? ["text", "image"] : ["text"]),
    outputModalities: cat?.outputModalities ?? ["text"],
    tags: [
      ...(item.EndpointModelType === "CustomModel" ? ["custom"] : []),
      ...(item.Status && item.Status !== "Running" ? [item.Status] : []),
      ...(cat?.tags ?? []),
    ],
    raw: item,
  };
}

// ---- API keys ----

export interface ArkApiKeySummary {
  id: number;
  name: string;
}

interface ListApiKeysResult {
  Items?: { Id?: number; Name?: string }[];
}

/** List the account's Ark API keys (id + name only). */
export async function listApiKeys(cred: VolcAkSk): Promise<ArkApiKeySummary[]> {
  const result = await callArk<ListApiKeysResult>(
    "ListApiKeys",
    { ProjectName: cred.project || DEFAULT_PROJECT, Filter: { AllowAll: true } },
    cred
  );
  return (result?.Items ?? [])
    .filter((it) => it.Id != null)
    .map((it) => ({ id: it.Id as number, name: it.Name ?? `key-${it.Id}` }));
}

interface GetRawApiKeyResult {
  ApiKey?: string;
}

/** Retrieve the raw secret value for a given Ark API key id. */
export async function getRawApiKey(
  id: number,
  cred: VolcAkSk
): Promise<string> {
  const result = await callArk<GetRawApiKeyResult>(
    "GetRawApiKey",
    { Id: id },
    cred
  );
  if (!result?.ApiKey) {
    throw new Error(i18n.t("provider_get_raw_api_key_empty", { ns: "common" }));
  }
  return result.ApiKey;
}
