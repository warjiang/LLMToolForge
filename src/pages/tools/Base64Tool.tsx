import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ToolPanel } from "./ToolPanel";
import { base64Decode, base64Encode } from "@/lib/tools";

type Mode = "encode" | "decode";

export function Base64Tool() {
  const { t } = useTranslation("pages");
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("encode");

  const result = useMemo(() => {
    if (!input) return { ok: true as const, value: "" };
    return mode === "encode" ? base64Encode(input) : base64Decode(input);
  }, [input, mode]);

  return (
    <ToolPanel
      input={input}
      onInputChange={setInput}
      output={result.ok ? result.value : ""}
      error={result.ok ? null : result.error}
      inputPlaceholder={
        mode === "encode"
          ? t("tool_base64_encode_placeholder")
          : t("tool_base64_decode_placeholder")
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
    />
  );
}
