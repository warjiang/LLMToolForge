import type { ModelInfo } from "@/lib/providers/types";

export function isImageGenerationModel(model: ModelInfo | null): boolean {
  const normalizedName = `${model?.id ?? ""} ${model?.name ?? ""}`.toLowerCase();
  return Boolean(
    model?.supportsImageGeneration ||
      model?.outputModalities?.includes("image") ||
      model?.tags?.includes("image-generation") ||
      normalizedName.includes("seedream") ||
      normalizedName.includes("seededit")
  );
}

export function isVideoGenerationModel(model: ModelInfo | null): boolean {
  const normalizedName = `${model?.id ?? ""} ${model?.name ?? ""}`.toLowerCase();
  return Boolean(
    model?.supportsVideoGeneration ||
      model?.outputModalities?.includes("video") ||
      model?.tags?.includes("video-generation") ||
      normalizedName.includes("seedance")
  );
}

/**
 * Conservative name-based heuristic for vision (image input) capability.
 *
 * Takes raw id/name strings (not a ModelInfo) so it also works for manual
 * connections, whose models are bare id strings without capability metadata.
 * Two token tiers keep false positives low: `VISION_SUBSTRINGS` are safe as
 * plain substrings; `VISION_BOUNDED` are short/ambiguous tokens (e.g. "vl",
 * "omni", "gpt-4o") that must sit on a non-alphanumeric boundary so they don't
 * match inside unrelated words. These two arrays are the only tuning surface.
 */
const VISION_SUBSTRINGS = [
  "vision",
  "multimodal",
  "internvl",
  "llava",
  "pixtral",
  "molmo",
  "doubao-seed",
  "doubao-vision",
  "glm-4v",
  "glm-4.5v",
  "step-1v",
];

const VISION_BOUNDED = [
  "vl",
  "omni",
  "gpt-4o",
  "gpt-4.1",
  "chatgpt-4o",
  "claude-3",
  "claude-sonnet-4",
  "claude-opus-4",
  "claude-4",
  "gemini-1.5",
  "gemini-2",
  "gemini-exp",
  "qwen-vl",
  "qwen2-vl",
  "qwen2.5-vl",
  "qwen3-vl",
  "yi-vision",
];

export function isVisionModel(id: string, name?: string): boolean {
  const s = `${id} ${name ?? ""}`.toLowerCase();
  if (VISION_SUBSTRINGS.some((t) => s.includes(t))) return true;
  return VISION_BOUNDED.some((t) => {
    const i = s.indexOf(t);
    if (i < 0) return false;
    const boundary = (c?: string) => c === undefined || !/[a-z0-9]/.test(c);
    return boundary(s[i - 1]) && boundary(s[i + t.length]);
  });
}
