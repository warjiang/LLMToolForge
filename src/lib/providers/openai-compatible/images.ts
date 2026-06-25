import type {
  ChatUsage,
  ImageGenerationImage,
  ImageGenerationRequest,
  ImageGenerationResult,
  ProviderCredential,
} from "@/lib/providers/types";
import i18n from "@/i18n/config";
import {
  authHeader,
  endpoint,
  gatewayFetch,
  normalizeBaseUrl,
} from "./request";

interface ImageItem {
  url?: string;
  b64_json?: string;
  b64Json?: string;
  revised_prompt?: string;
  revisedPrompt?: string;
}

interface ImageResponse {
  data?: ImageItem[];
  url?: string;
  b64_json?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function imageFromItem(item: ImageItem): ImageGenerationImage {
  return {
    url: item.url,
    b64Json: item.b64_json ?? item.b64Json,
    revisedPrompt: item.revised_prompt ?? item.revisedPrompt,
  };
}

function extractImages(json: ImageResponse): ImageGenerationImage[] {
  if (Array.isArray(json.data)) {
    return json.data.map(imageFromItem).filter((image) => image.url || image.b64Json);
  }
  const single = imageFromItem(json);
  return single.url || single.b64Json ? [single] : [];
}

function usageFromResponse(json: ImageResponse): ChatUsage | undefined {
  if (!json.usage) return undefined;
  return {
    promptTokens: json.usage.prompt_tokens,
    completionTokens: json.usage.completion_tokens,
    totalTokens: json.usage.total_tokens,
  };
}

async function postImages(
  cred: ProviderCredential,
  body: unknown,
  signal?: AbortSignal
) {
  return gatewayFetch(endpoint(normalizeBaseUrl(cred), "images/generations"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader(cred),
    },
    body: JSON.stringify(body),
    signal,
  });
}

export async function imageGeneration(
  req: ImageGenerationRequest,
  cred: ProviderCredential
): Promise<ImageGenerationResult> {
  const body: Record<string, unknown> = {
    model: req.model,
    prompt: req.prompt,
    response_format: req.responseFormat ?? "url",
    size: req.size ?? "1024x1024",
    stream: false,
  };

  const res = await postImages(cred, body, req.signal);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      i18n.t("provider_http_failed", {
        ns: "common",
        label: "Images",
        status: res.status,
        text: text.slice(0, 300),
      })
    );
  }
  const json = (await res.json()) as ImageResponse;
  const images = extractImages(json);
  if (images.length === 0) {
    throw new Error(i18n.t("provider_images_empty", { ns: "common" }));
  }
  return {
    images,
    usage: usageFromResponse(json),
    raw: json,
  };
}
