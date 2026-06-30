import { useMemo, useState } from "react";
import {
  AlignLeft,
  Check,
  Clipboard,
  Copy,
  Minimize2,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { jsonFormat, jsonMinify, parseJson } from "@/lib/tools";
import { JsonDiagram } from "./diagram/JsonDiagram";

const SAMPLE =
  '{"name":"demo","payload":"{\\"nested\\":\\"{\\\\\\"deep\\\\\\":true}\\",\\"count\\":3}","tags":"[\\"a\\",\\"b\\"]"}';

export function JsonTool() {
  const { t } = useTranslation("pages");
  const tc = useTranslation("common").t;
  const [input, setInput] = useState("");
  const [preserveEscape, setPreserveEscape] = useState(false);
  const [copied, setCopied] = useState(false);

  const parsed = useMemo(
    () => parseJson(input, { preserveEscape }),
    [input, preserveEscape]
  );

  const format = () => {
    const r = jsonFormat(input, { indent: 2, preserveEscape });
    if (r.ok && r.value) setInput(r.value);
  };

  const minify = () => {
    const r = jsonMinify(input, { preserveEscape });
    if (r.ok && r.value) setInput(r.value);
  };

  const copy = async () => {
    const r = jsonFormat(input, { indent: 2, preserveEscape });
    if (!r.ok || !r.value) return;
    await navigator.clipboard?.writeText(r.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard?.readText();
      if (text) setInput(text);
    } catch {
      /* clipboard read may be blocked */
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      {/* 输入区域 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>{t("tool_json_input")}</Label>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={paste} title={tc("paste")}>
                <Clipboard className="h-3.5 w-3.5" />
                {tc("paste")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setInput("")}
                title={tc("clear")}
                disabled={!input}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {tc("clear")}
              </Button>
            </div>
            <div className="h-4 w-px bg-border" />
            <Button variant="secondary" size="sm" onClick={() => setInput(SAMPLE)}>
              {t("tool_fill_sample")}
            </Button>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-2">
              <Switch
                id="json-preserve"
                checked={preserveEscape}
                onCheckedChange={setPreserveEscape}
              />
              <Label htmlFor="json-preserve" className="cursor-pointer font-normal text-xs">
                {t("tool_json_preserve_escape")}
              </Label>
            </div>
          </div>
        </div>
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("tool_json_placeholder")}
          spellCheck={false}
          className="h-32 resize-y font-mono text-copy-13 leading-relaxed"
        />
      </div>

      {/* 工具栏 */}
      <div className="flex items-center gap-1 border-b border-border pb-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={format}
          title={t("tool_json_format")}
          disabled={!parsed.ok || parsed.value === undefined}
        >
          <AlignLeft className="h-3.5 w-3.5" />
          {t("tool_json_format")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={minify}
          title={t("tool_json_minify")}
          disabled={!parsed.ok || parsed.value === undefined}
        >
          <Minimize2 className="h-3.5 w-3.5" />
          {t("tool_json_minify")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={copy}
          title={tc("copy")}
          disabled={!parsed.ok || parsed.value === undefined}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-success" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {/* JSON 图形化展示 */}
      <div className="flex-1 min-h-0">
           {parsed.ok && parsed.value ? (
             <JsonDiagram jsonInput={input} maxDepth={3} />
           ) : (
             <div className="flex h-full items-center justify-center rounded-md border border-border bg-background-secondary">
               <div className="text-center">
                 <p className="text-muted-foreground">{tc("result_placeholder")}</p>
                 {!parsed.ok && parsed.error && (
                   <p className="mt-2 text-xs text-destructive">{parsed.error}</p>
                 )}
               </div>
             </div>
           )}
      </div>
    </div>
  );
}
