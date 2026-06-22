import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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
        <div className="inline-flex rounded-md border border-border p-1">
          <Button
            variant={mode === "encode" ? "primary" : "ghost"}
            size="sm"
            onClick={() => setMode("encode")}
          >
            编码
          </Button>
          <Button
            variant={mode === "decode" ? "primary" : "ghost"}
            size="sm"
            onClick={() => setMode("decode")}
          >
            解码
          </Button>
        </div>
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
