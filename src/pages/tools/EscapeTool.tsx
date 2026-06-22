import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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
        <div className="inline-flex rounded-md border border-border p-1">
          <Button
            variant={mode === "escape" ? "primary" : "ghost"}
            size="sm"
            onClick={() => setMode("escape")}
          >
            转义
          </Button>
          <Button
            variant={mode === "unescape" ? "primary" : "ghost"}
            size="sm"
            onClick={() => setMode("unescape")}
          >
            去转义
          </Button>
        </div>
      }
    />
  );
}
