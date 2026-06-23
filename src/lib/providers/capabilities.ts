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
