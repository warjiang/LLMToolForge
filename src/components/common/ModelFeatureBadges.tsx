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

/** Renders capability badges (context window, tools, vision, tags) for a model. */
export function ModelFeatureBadges({ model }: { model: ModelInfo }) {
  const ctx = formatContext(model.contextWindow);
  const supportsImageGeneration = isImageGenerationModel(model);
  const supportsVideoGeneration = isVideoGenerationModel(model);
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
