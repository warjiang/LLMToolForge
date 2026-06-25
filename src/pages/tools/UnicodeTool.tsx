import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ToolPanel } from "./ToolPanel";
import { unicodeDecode, unicodeEncode } from "@/lib/tools";

type Mode = "encode" | "decode";

export function UnicodeTool() {
  const { t } = useTranslation("pages");
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("encode");
  const [asciiOnly, setAsciiOnly] = useState(true);

  const result = useMemo(() => {
    if (!input) return { ok: true as const, value: "" };
    return mode === "encode"
      ? unicodeEncode(input, asciiOnly)
      : unicodeDecode(input);
  }, [input, mode, asciiOnly]);

  return (
    <ToolPanel
      input={input}
      onInputChange={setInput}
      output={result.ok ? result.value : ""}
      error={result.ok ? null : result.error}
      inputPlaceholder={
        mode === "encode"
          ? t("tool_encode_placeholder")
          : t("tool_decode_placeholder")
      }
      onSwap={() => result.ok && setInput(result.value)}
      actions={
        <SegmentedControl
          size="sm"
          aria-label={t("tool_unicode_mode")}
          value={mode}
          onChange={setMode}
          options={[
            { value: "encode", label: t("tool_encode") },
            { value: "decode", label: t("tool_decode") },
          ]}
        />
      }
      options={
        mode === "encode" ? (
          <div className="flex items-center gap-2">
            <Switch
              id="uni-ascii"
              checked={asciiOnly}
              onCheckedChange={setAsciiOnly}
            />
            <Label htmlFor="uni-ascii" className="cursor-pointer font-normal">
              {t("tool_keep_ascii")}
            </Label>
          </div>
        ) : undefined
      }
    />
  );
}
