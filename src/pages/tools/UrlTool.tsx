import { useMemo, useState } from "react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ToolPanel } from "./ToolPanel";
import { urlDecode, urlEncode } from "@/lib/tools";

type Mode = "encode" | "decode";

export function UrlTool() {
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
          ? "输入要编码的文本，例如 https://a.com/?q=你好 世界"
          : "输入要解码的文本，例如 %E4%BD%A0%E5%A5%BD"
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
        <div className="flex items-center gap-2">
          <Switch id="url-full" checked={full} onCheckedChange={setFull} />
          <Label htmlFor="url-full" className="cursor-pointer font-normal">
            整段 URL 模式 (encodeURI)
          </Label>
        </div>
      }
    />
  );
}
