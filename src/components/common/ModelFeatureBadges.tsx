import { Brain, Eye, ImageIcon, Video, Wrench } from "lucide-react";
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
  if (model.supportsVision) labels.push("多模态");
  if (supportsImageGeneration) labels.push("生图");
  if (supportsVideoGeneration) labels.push("生视频");
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
          多模态
        </Badge>
      )}
      {supportsImageGeneration && (
        <Badge variant="success">
          <ImageIcon className="h-3 w-3" />
          生图
        </Badge>
      )}
      {supportsVideoGeneration && (
        <Badge variant="success">
          <Video className="h-3 w-3" />
          生视频
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
