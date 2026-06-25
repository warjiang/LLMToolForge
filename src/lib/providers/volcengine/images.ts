import type {
  ChatUsage,
  ImageGenerationImage,
  ImageGenerationRequest,
  ImageGenerationResult,
  ProviderCredential,
} from "@/lib/providers/types";
import i18n from "@/i18n/config";
import { ensureOk, postArkJson } from "./request";

interface ArkImageItem {
  url?: string;
  b64_json?: string;
  b64Json?: string;
  revised_prompt?: string;
  revisedPrompt?: string;
}

interface ArkImageResponse {
  data?: ArkImageItem[];
  url?: string;
  b64_json?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function usageFromArk(json: ArkImageResponse): ChatUsage | undefined {
  if (!json.usage) return undefined;
  return {
    promptTokens: json.usage.prompt_tokens,
    completionTokens: json.usage.completion_tokens,
    totalTokens: json.usage.total_tokens,
  };
}

function imageFromItem(item: ArkImageItem): ImageGenerationImage {
  return {
    url: item.url,
    b64Json: item.b64_json ?? item.b64Json,
    revisedPrompt: item.revised_prompt ?? item.revisedPrompt,
  };
}

function extractImages(json: ArkImageResponse): ImageGenerationImage[] {
  if (Array.isArray(json.data)) {
    return json.data.map(imageFromItem).filter((image) => image.url || image.b64Json);
  }
  const single = imageFromItem(json);
  return single.url || single.b64Json ? [single] : [];
}

export async function imageGeneration(
  req: ImageGenerationRequest,
  cred: ProviderCredential
): Promise<ImageGenerationResult> {
  const body: Record<string, unknown> = {
    model: req.model,
    prompt: req.prompt,
    sequential_image_generation: req.sequentialImageGeneration ?? "disabled",
    response_format: req.responseFormat ?? "url",
    size: req.size ?? "2K",
    stream: false,
    watermark: req.watermark ?? true,
  };

  const res = await postArkJson(cred, "/images/generations", body, req.signal);
  await ensureOk(res, "Images");
  const json = (await res.json()) as ArkImageResponse;
  const images = extractImages(json);
  if (images.length === 0) {
    throw new Error(i18n.t("provider_images_empty", { ns: "common" }));
  }
  return {
    images,
    usage: usageFromArk(json),
    raw: json,
  };
}
