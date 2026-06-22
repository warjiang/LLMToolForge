import { Brain, Eye, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ModelInfo } from "@/lib/providers/types";

function formatContext(tokens?: number): string | null {
  if (!tokens) return null;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k ctx`;
  return `${tokens} ctx`;
}

/** Renders capability badges (context window, tools, vision, tags) for a model. */
export function ModelFeatureBadges({ model }: { model: ModelInfo }) {
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
      {model.tags?.includes("thinking") && (
        <Badge variant="warning">
          <Brain className="h-3 w-3" />
          Thinking
        </Badge>
      )}
      {model.tags
        ?.filter((t) => t !== "thinking")
        .map((t) => (
          <Badge key={t} variant="outline">
            {t}
          </Badge>
        ))}
    </div>
  );
}
