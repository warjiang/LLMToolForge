import { Check, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ModelIcon } from "@/components/common/ProviderModelIcon";
import { Button } from "@/components/ui/button";
import type { ModelInfo } from "@/lib/providers/types";

export function dedupeModels(models: ModelInfo[]): ModelInfo[] {
  const seen = new Set<string>();
  const result: ModelInfo[] = [];
  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(model);
  }
  return result;
}

export function ProviderModelCandidateList({
  models,
  candidates,
  onAdd,
}: {
  models: ModelInfo[];
  candidates: ModelInfo[];
  onAdd: (model: ModelInfo) => Promise<void>;
}) {
  const { t } = useTranslation("pages");
  return (
    <div className="mt-4 grid gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-label-12 font-medium text-muted-foreground">
          {t("provider_candidate_models_label")}
        </span>
        <span className="text-label-12 text-muted-foreground">
          {t("provider_candidate_models_count", { count: candidates.length })}
        </span>
      </div>
      <div
        aria-label={t("provider_candidate_models_label")}
        className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto rounded-sm border border-border bg-muted/20 p-2"
      >
        {candidates.map((model) => {
          const selected = models.some((m) => m.id === model.id);
          return (
            <Button
              key={model.id}
              type="button"
              size="sm"
              variant={selected ? "secondary" : "tertiary"}
              className="h-7 gap-1.5 rounded-full px-2 text-label-12"
              disabled={selected}
              aria-label={t(
                selected ? "provider_model_added" : "provider_add_model",
                { id: model.id }
              )}
              onClick={() => void onAdd(model)}
            >
              {selected ? (
                <Check className="h-3 w-3" />
              ) : (
                <Plus className="h-3 w-3" />
              )}
              <ModelIcon model={model} className="h-3.5 w-3.5" />
              {model.name}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
