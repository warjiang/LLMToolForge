import { useMemo, useState } from "react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ToolPanel } from "./ToolPanel";
import { jsonEscape, jsonUnescape } from "@/lib/tools";

type Mode = "escape" | "unescape";

export function EscapeTool() {
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
          ? '输入原始文本，将转义为 JSON 字符串字面量（换行→\\n、引号→\\"）'
          : '输入带转义的文本，例如 line1\\nline2\\t\\"quoted\\"'
      }
      onSwap={() => result.ok && setInput(result.value)}
      actions={
        <SegmentedControl
          size="sm"
          aria-label="转义模式"
          value={mode}
          onChange={setMode}
          options={[
            { value: "escape", label: "转义" },
            { value: "unescape", label: "去转义" },
          ]}
        />
      }
    />
  );
}
