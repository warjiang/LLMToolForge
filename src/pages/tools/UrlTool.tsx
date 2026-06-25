import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ToolPanel } from "./ToolPanel";
import { urlDecode, urlEncode } from "@/lib/tools";

type Mode = "encode" | "decode";

export function UrlTool() {
  const { t } = useTranslation("pages");
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("encode");
  const [full, setFull] = useState(false);

  const result = useMemo(() => {
    if (!input) return { ok: true as const, value: "" };
    return mode === "encode" ? urlEncode(input, full) : urlDecode(input, full);
  }, [input, mode, full]);

  return (
    <ToolPanel
      input={input}
      onInputChange={setInput}
      output={result.ok ? result.value : ""}
      error={result.ok ? null : result.error}
      inputPlaceholder={
        mode === "encode"
          ? t("tool_url_encode_placeholder")
          : t("tool_url_decode_placeholder")
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
        <div className="flex items-center gap-2">
          <Switch id="url-full" checked={full} onCheckedChange={setFull} />
          <Label htmlFor="url-full" className="cursor-pointer font-normal">
            {t("tool_url_full_mode")}
          </Label>
        </div>
      }
    />
  );
}
