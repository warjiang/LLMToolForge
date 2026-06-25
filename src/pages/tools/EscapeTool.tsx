import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ToolPanel } from "./ToolPanel";
import { jsonEscape, jsonUnescape } from "@/lib/tools";

type Mode = "escape" | "unescape";

export function EscapeTool() {
  const { t } = useTranslation("pages");
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("escape");

  const result = useMemo(() => {
    if (!input) return { ok: true as const, value: "" };
    return mode === "escape" ? jsonEscape(input) : jsonUnescape(input);
  }, [input, mode]);

  return (
    <ToolPanel
      input={input}
      onInputChange={setInput}
      output={result.ok ? result.value : ""}
      error={result.ok ? null : result.error}
      inputPlaceholder={
        mode === "escape"
          ? t("tool_escape_input_placeholder")
          : t("tool_unescape_input_placeholder")
      }
      onSwap={() => result.ok && setInput(result.value)}
      actions={
        <SegmentedControl
          size="sm"
          aria-label={t("tool_escape_mode")}
          value={mode}
          onChange={setMode}
          options={[
            { value: "escape", label: t("tool_escape") },
            { value: "unescape", label: t("tool_unescape") },
          ]}
        />
      }
    />
  );
}
