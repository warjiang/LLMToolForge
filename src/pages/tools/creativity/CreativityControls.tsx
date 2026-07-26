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
  CombinationSource,
  CreativityItemCount,
  CreativityMode,
  CreativityPromptOptions,
} from "@/lib/creativity/types";
import { cn } from "@/lib/utils";
import {
  PresetCustomSelect,
  type SelectPreset,
} from "./PresetCustomSelect";

interface CreativityControlsProps {
  mode: CreativityMode;
  source: CombinationSource;
  customItems: string[];
  error: string | null;
  options: CreativityPromptOptions;
  models: ExposedModel[];
  modelId: string;
  loading: boolean;
  onModeChange: (mode: CreativityMode) => void;
  onSourceChange: (source: CombinationSource) => void;
  onCustomItemChange: (index: number, value: string) => void;
  onOptionsChange: (options: CreativityPromptOptions) => void;
  onModelChange: (modelId: string) => void;
  onGenerate: () => void;
  onShowHistory: () => void;
}

const MODE_VALUES: CreativityMode[] = ["inspiration", "training"];
const ITEM_COUNTS: CreativityItemCount[] = [2, 3, 4, 5, 6];

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
  source,
  customItems,
  error,
  options,
  models,
  modelId,
  loading,
  onModeChange,
  onSourceChange,
  onCustomItemChange,
  onOptionsChange,
  onModelChange,
  onGenerate,
  onShowHistory,
}: CreativityControlsProps) {
  const { t } = useTranslation("pages");
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  const patchOptions = (patch: Partial<CreativityPromptOptions>) =>
    onOptionsChange({ ...options, ...patch });
  const customLabel = t("creativity_custom_option");
  const distances = presets(
    ["near", "cross-domain", "far"],
    (value) => t(`creativity_distance_${value}`),
  );
  const domains = presets(
    ["any", "daily", "technology", "nature", "art"],
    (value) => t(`creativity_domain_${value}`),
  );
  const abstractions = presets(
    ["concrete", "abstract", "mixed"],
    (value) => t(`creativity_abstraction_${value}`),
  );
  const purposes = presets(
    ["divergent", "product", "story", "problem-solving"],
    (value) => t(`creativity_purpose_${value}`),
  );

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

      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-background-secondary p-4">
        <div className="flex basis-full flex-wrap items-center gap-2">
          <span className="mr-1 text-label-13 font-medium">
            {t("creativity_source")}
          </span>
          {(["ai", "custom"] as const).map((value) => (
            <ToggleButton
              key={value}
              active={source === value}
              onClick={() => onSourceChange(value)}
            >
              {t(`creativity_source_${value}`)}
            </ToggleButton>
          ))}
        </div>

        <div className="min-w-[110px] flex-1 space-y-1.5">
          <Label>{t("creativity_item_count")}</Label>
          <Select
            value={String(options.itemCount)}
            onValueChange={(value) =>
              patchOptions({
                itemCount: Number(value) as CreativityItemCount,
              })
            }
          >
            <SelectTrigger aria-label={t("creativity_item_count")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ITEM_COUNTS.map((count) => (
                <SelectItem key={count} value={String(count)}>
                  {count}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <PresetCustomSelect
          className="min-w-[180px] flex-[1.2] space-y-1.5"
          label={t("creativity_distance")}
          value={options.semanticDistance}
          presets={distances}
          customLabel={customLabel}
          customPlaceholder={t("creativity_distance_custom_placeholder")}
          onChange={(semanticDistance) =>
            patchOptions({ semanticDistance })
          }
        />

        <Button
          variant="secondary"
          className="xl:hidden"
          onClick={() => setAdvancedOpen(true)}
        >
          <Settings2 className="h-4 w-4" />
          {t("creativity_more_settings")}
        </Button>

        <div className="hidden min-w-[540px] flex-[3] grid-cols-3 gap-3 xl:grid">
          <AdvancedFields
            options={options}
            labels={{
              domain: t("creativity_domain"),
              abstraction: t("creativity_abstraction"),
              purpose: t("creativity_purpose"),
            }}
            customLabel={customLabel}
            domains={domains}
            abstractions={abstractions}
            purposes={purposes}
            onPatch={patchOptions}
            t={t}
          />
        </div>

        {source === "custom" && (
          <div className="grid basis-full gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {customItems.map((value, index) => {
              const label = t("creativity_custom_item_label", {
                index: index + 1,
              });
              return (
                <div key={index} className="space-y-1.5">
                  <Label htmlFor={`creativity-custom-item-${index}`}>
                    {label}
                  </Label>
                  <Input
                    id={`creativity-custom-item-${index}`}
                    aria-label={label}
                    value={value}
                    maxLength={24}
                    placeholder={t("creativity_custom_item_placeholder")}
                    onChange={(event) =>
                      onCustomItemChange(index, event.target.value)
                    }
                  />
                </div>
              );
            })}
          </div>
        )}

        {source === "custom" && error && (
          <p className="basis-full text-label-13 text-destructive">
            {error}
          </p>
        )}

        <Button
          className="ml-auto shrink-0"
          onClick={onGenerate}
          disabled={source === "ai" && !modelId}
        >
          <Sparkles className="h-4 w-4" />
          {source === "custom"
            ? t("creativity_use_custom")
            : loading
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
          <div className="space-y-4 xl:hidden">
            <AdvancedFields
              options={options}
              labels={{
                domain: t("creativity_more_field", {
                  field: t("creativity_domain"),
                }),
                abstraction: t("creativity_more_field", {
                  field: t("creativity_abstraction"),
                }),
                purpose: t("creativity_more_field", {
                  field: t("creativity_purpose"),
                }),
              }}
              customLabel={customLabel}
              domains={domains}
              abstractions={abstractions}
              purposes={purposes}
              onPatch={patchOptions}
              t={t}
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

function presets(
  values: string[],
  labelFor: (value: string) => string,
): SelectPreset[] {
  return values.map((value) => ({ value, label: labelFor(value) }));
}

function AdvancedFields({
  options,
  labels,
  customLabel,
  domains,
  abstractions,
  purposes,
  onPatch,
  t,
}: {
  options: CreativityPromptOptions;
  labels: { domain: string; abstraction: string; purpose: string };
  customLabel: string;
  domains: SelectPreset[];
  abstractions: SelectPreset[];
  purposes: SelectPreset[];
  onPatch: (patch: Partial<CreativityPromptOptions>) => void;
  t: (key: string) => string;
}) {
  return (
    <>
      <PresetCustomSelect
        label={labels.domain}
        value={options.domain}
        presets={domains}
        customLabel={customLabel}
        customPlaceholder={t("creativity_domain_placeholder")}
        onChange={(domain) => onPatch({ domain })}
      />
      <PresetCustomSelect
        label={labels.abstraction}
        value={options.abstraction}
        presets={abstractions}
        customLabel={customLabel}
        customPlaceholder={t("creativity_abstraction_custom_placeholder")}
        onChange={(abstraction) => onPatch({ abstraction })}
      />
      <PresetCustomSelect
        label={labels.purpose}
        value={options.purpose}
        presets={purposes}
        customLabel={customLabel}
        customPlaceholder={t("creativity_purpose_custom_placeholder")}
        onChange={(purpose) => onPatch({ purpose })}
      />
    </>
  );
}
