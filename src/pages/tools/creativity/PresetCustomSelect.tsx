import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const CUSTOM_VALUE = "__custom__";

export interface SelectPreset {
  value: string;
  label: string;
}

interface PresetCustomSelectProps {
  label: string;
  value: string;
  presets: SelectPreset[];
  customLabel: string;
  customPlaceholder: string;
  onChange: (value: string) => void;
  className?: string;
}

export function PresetCustomSelect({
  label,
  value,
  presets,
  customLabel,
  customPlaceholder,
  onChange,
  className,
}: PresetCustomSelectProps) {
  const presetSelected = presets.some((preset) => preset.value === value);
  const selectValue = presetSelected ? value : CUSTOM_VALUE;

  return (
    <div className={className ?? "space-y-1.5"}>
      <Label>{label}</Label>
      <Select
        value={selectValue}
        onValueChange={(next) => {
          onChange(next === CUSTOM_VALUE ? "" : next);
        }}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {presets.map((preset) => (
            <SelectItem key={preset.value} value={preset.value}>
              {preset.label}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM_VALUE}>{customLabel}</SelectItem>
        </SelectContent>
      </Select>
      {!presetSelected && (
        <Input
          aria-label={`${customLabel.replace(/…$/, "")}${label}`}
          value={value}
          placeholder={customPlaceholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}
