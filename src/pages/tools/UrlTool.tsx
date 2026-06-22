import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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
