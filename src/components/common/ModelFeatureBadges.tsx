import { Brain, Eye, ImageIcon, Video, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import {
  isImageGenerationModel,
  isVideoGenerationModel,
} from "@/lib/providers/capabilities";
import type { ModelInfo } from "@/lib/providers/types";

function formatContext(tokens?: number): string | null {
  if (!tokens) return null;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k ctx`;
  return `${tokens} ctx`;
}

export function getModelFeatureLabels(model: ModelInfo): string[] {
  const labels: string[] = [];
  const ctx = formatContext(model.contextWindow);
  const supportsImageGeneration = isImageGenerationModel(model);
  const supportsVideoGeneration = isVideoGenerationModel(model);

  if (ctx) labels.push(ctx);
  if (model.supportsFunctionCall) labels.push("Function Call");
  if (model.supportsVision) labels.push("Multimodal");
  if (supportsImageGeneration) labels.push("Image Gen");
  if (supportsVideoGeneration) labels.push("Video Gen");
  if (model.tags?.includes("thinking")) labels.push("Thinking");
  labels.push(
    ...(model.tags?.filter(
      (t) =>
        t !== "thinking" &&
        t !== "image-generation" &&
        t !== "video-generation"
    ) ?? [])
  );

  return labels;
}

export function getModelFeatureTitle(model: ModelInfo | null): string | undefined {
  if (!model) return undefined;
  const labels = getModelFeatureLabels(model);
  if (labels.length === 0) return model.name;
  return `${model.name}\n${labels.join(" · ")}`;
}

/** Renders capability badges (context window, tools, vision, tags) for a model. */
export function ModelFeatureBadges({ model }: { model: ModelInfo }) {
  const { t } = useTranslation("common");
  const supportsImageGeneration = isImageGenerationModel(model);
  const supportsVideoGeneration = isVideoGenerationModel(model);
  const ctx = formatContext(model.contextWindow);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ctx && <Badge variant="outline">{ctx}</Badge>}
      {model.supportsFunctionCall && (
        <Badge variant="accent">
          <Wrench className="h-3 w-3" />
          Function Call
        </Badge>
      )}
      {model.supportsVision && (
        <Badge variant="success">
          <Eye className="h-3 w-3" />
          {t("multimodal")}
        </Badge>
      )}
      {supportsImageGeneration && (
        <Badge variant="success">
          <ImageIcon className="h-3 w-3" />
          {t("image_gen")}
        </Badge>
      )}
      {supportsVideoGeneration && (
        <Badge variant="success">
          <Video className="h-3 w-3" />
          {t("video_gen")}
        </Badge>
      )}
      {model.tags?.includes("thinking") && (
        <Badge variant="warning">
          <Brain className="h-3 w-3" />
          Thinking
        </Badge>
      )}
      {model.tags
        ?.filter(
          (t) =>
            t !== "thinking" &&
            t !== "image-generation" &&
            t !== "video-generation"
        )
        .map((t) => (
          <Badge key={t} variant="outline">
            {t}
          </Badge>
        ))}
    </div>
  );
}
