import { useMemo, useState } from "react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ToolPanel } from "./ToolPanel";
import { unicodeDecode, unicodeEncode } from "@/lib/tools";

type Mode = "encode" | "decode";

export function UnicodeTool() {
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
          ? "输入文本，例如 你好 → \\u4f60\\u597d"
          : "输入 \\uXXXX / \\xXX / &#...; 序列，例如 \\u4f60\\u597d"
      }
      onSwap={() => result.ok && setInput(result.value)}
      actions={
        <SegmentedControl
          size="sm"
          aria-label="编码模式"
          value={mode}
          onChange={setMode}
          options={[
            { value: "encode", label: "编码" },
            { value: "decode", label: "解码" },
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
              保留可见 ASCII
            </Label>
          </div>
        ) : undefined
      }
    />
  );
}
