import * as React from "react";
import { History, Settings2, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ExposedModel } from "@/lib/unifiedApi";
import type {
  AbstractionLevel,
  CreativityMode,
  CreativityPromptOptions,
  CreativityPurpose,
  SemanticDistance,
} from "@/lib/creativity/types";
import { cn } from "@/lib/utils";

interface CreativityControlsProps {
  mode: CreativityMode;
  options: CreativityPromptOptions;
  models: ExposedModel[];
  modelId: string;
  loading: boolean;
  onModeChange: (mode: CreativityMode) => void;
  onOptionsChange: (options: CreativityPromptOptions) => void;
  onModelChange: (modelId: string) => void;
  onGenerate: () => void;
  onShowHistory: () => void;
}

const MODE_VALUES: CreativityMode[] = ["inspiration", "training"];
const DISTANCES: SemanticDistance[] = ["near", "cross-domain", "far"];

function ToggleButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-sm border px-3 py-1.5 text-label-13 transition-colors",
        active
          ? "border-foreground/20 bg-foreground text-background"
          : "border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function CreativityControls({
  mode,
  options,
  models,
  modelId,
  loading,
  onModeChange,
  onOptionsChange,
  onModelChange,
  onGenerate,
  onShowHistory,
}: CreativityControlsProps) {
  const { t } = useTranslation("pages");
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  const patchOptions = (patch: Partial<CreativityPromptOptions>) =>
    onOptionsChange({ ...options, ...patch });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {MODE_VALUES.map((value) => (
            <ToggleButton
              key={value}
              active={mode === value}
              onClick={() => onModeChange(value)}
            >
              {t(`creativity_mode_${value}`)}
            </ToggleButton>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <div className="min-w-[220px] space-y-1">
            <Label>{t("creativity_model")}</Label>
            <Select
              value={modelId}
              onValueChange={onModelChange}
              disabled={models.length === 0}
            >
              <SelectTrigger aria-label={t("creativity_model")}>
                <SelectValue
                  placeholder={t("creativity_model_placeholder")}
                />
              </SelectTrigger>
              <SelectContent>
                {models.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="secondary" onClick={onShowHistory}>
            <History className="h-4 w-4" />
            {t("creativity_history")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-md border border-border bg-background-secondary p-4">
        <div className="space-y-1.5">
          <Label>{t("creativity_item_count")}</Label>
          <div className="flex gap-2">
            {([2, 3] as const).map((count) => (
              <ToggleButton
                key={count}
                active={options.itemCount === count}
                onClick={() => patchOptions({ itemCount: count })}
              >
                {count}
              </ToggleButton>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>{t("creativity_distance")}</Label>
          <div className="flex flex-wrap gap-2">
            {DISTANCES.map((distance) => (
              <ToggleButton
                key={distance}
                active={options.semanticDistance === distance}
                onClick={() =>
                  patchOptions({ semanticDistance: distance })
                }
              >
                {t(`creativity_distance_${distance}`)}
              </ToggleButton>
            ))}
          </div>
        </div>

        <Button
          variant="secondary"
          onClick={() => setAdvancedOpen(true)}
        >
          <Settings2 className="h-4 w-4" />
          {t("creativity_more_settings")}
        </Button>

        <Button
          className="ml-auto"
          onClick={onGenerate}
          disabled={!modelId}
        >
          <Sparkles className="h-4 w-4" />
          {loading
            ? t("creativity_regenerate")
            : t("creativity_generate")}
        </Button>
      </div>

      <Dialog open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("creativity_more_settings")}</DialogTitle>
            <DialogDescription>
              {t("creativity_more_settings_desc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="creativity-domain">
                {t("creativity_domain")}
              </Label>
              <Input
                id="creativity-domain"
                value={options.domain === "any" ? "" : options.domain}
                placeholder={t("creativity_domain_placeholder")}
                onChange={(event) =>
                  patchOptions({ domain: event.target.value || "any" })
                }
              />
            </div>
            <AdvancedSelect
              label={t("creativity_abstraction")}
              value={options.abstraction}
              values={["concrete", "abstract", "mixed"]}
              labelFor={(value) =>
                t(`creativity_abstraction_${value}`)
              }
              onChange={(value) =>
                patchOptions({ abstraction: value as AbstractionLevel })
              }
            />
            <AdvancedSelect
              label={t("creativity_purpose")}
              value={options.purpose}
              values={["divergent", "product", "story", "problem-solving"]}
              labelFor={(value) => t(`creativity_purpose_${value}`)}
              onChange={(value) =>
                patchOptions({ purpose: value as CreativityPurpose })
              }
            />
          </div>
          <DialogFooter>
            <Button onClick={() => setAdvancedOpen(false)}>
              {t("creativity_settings_done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AdvancedSelect({
  label,
  value,
  values,
  labelFor,
  onChange,
}: {
  label: string;
  value: string;
  values: string[];
  labelFor: (value: string) => string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {values.map((item) => (
            <SelectItem key={item} value={item}>
              {labelFor(item)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
