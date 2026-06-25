import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ToolPanel } from "./ToolPanel";
import { jsonPreview } from "@/lib/tools";

const SAMPLE =
  '{"name":"demo","payload":"{\\"nested\\":\\"{\\\\\\"deep\\\\\\":true}\\",\\"count\\":3}","tags":"[\\"a\\",\\"b\\"]"}';

export function JsonTool() {
  const { t } = useTranslation("pages");
  const [input, setInput] = useState("");
  const [deep, setDeep] = useState(true);
  const [indent, setIndent] = useState(2);

  const result = useMemo(
    () => jsonPreview(input, { deep, indent }),
    [input, deep, indent]
  );

  return (
    <ToolPanel
      input={input}
      onInputChange={setInput}
      output={result.ok ? result.value : ""}
      error={result.ok ? null : result.error}
      inputLabel={t("tool_json_input")}
      outputLabel={t("tool_json_output")}
      inputPlaceholder={t("tool_json_placeholder")}
      actions={
        <Button variant="secondary" size="sm" onClick={() => setInput(SAMPLE)}>
          {t("tool_fill_sample")}
        </Button>
      }
      options={
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch id="json-deep" checked={deep} onCheckedChange={setDeep} />
            <Label htmlFor="json-deep" className="cursor-pointer font-normal">
              {t("tool_json_deep")}
            </Label>
          </div>
          <SegmentedControl
            size="sm"
            aria-label={t("tool_indent_label")}
            value={String(indent)}
            onChange={(v) => setIndent(Number(v))}
            options={[
              { value: "2", label: t("tool_2_spaces") },
              { value: "4", label: t("tool_4_spaces") },
            ]}
          />
        </div>
      }
    />
  );
}
