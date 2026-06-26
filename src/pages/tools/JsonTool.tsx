import { useMemo, useState } from "react";
import {
  AlignLeft,
  Check,
  Clipboard,
  Copy,
  FoldVertical,
  Minimize2,
  Trash2,
  UnfoldVertical,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { jsonFormat, jsonMinify, parseJson } from "@/lib/tools";
import { JsonTree } from "./JsonTree";

const SAMPLE =
  '{"name":"demo","payload":"{\\"nested\\":\\"{\\\\\\"deep\\\\\\":true}\\",\\"count\\":3}","tags":"[\\"a\\",\\"b\\"]"}';

export function JsonTool() {
  const { t } = useTranslation("pages");
  const tc = useTranslation("common").t;
  const [input, setInput] = useState("");
  const [preserveEscape, setPreserveEscape] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expandSignal, setExpandSignal] = useState(1);
  const [collapseSignal, setCollapseSignal] = useState(0);

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

  const expandAll = () => setExpandSignal(collapseSignal + 1);
  const collapseAll = () => setCollapseSignal(expandSignal + 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onClick={() => setInput(SAMPLE)}>
          {t("tool_fill_sample")}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Switch
            id="json-preserve"
            checked={preserveEscape}
            onCheckedChange={setPreserveEscape}
          />
          <Label htmlFor="json-preserve" className="cursor-pointer font-normal">
            {t("tool_json_preserve_escape")}
          </Label>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>{t("tool_json_input")}</Label>
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
          </div>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("tool_json_placeholder")}
            spellCheck={false}
            className="min-h-[360px] resize-y font-mono text-copy-13 leading-relaxed"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>{t("tool_json_output")}</Label>
            <div className="flex items-center gap-1">
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
                onClick={expandAll}
                title={t("tool_json_expand_all")}
              >
                <UnfoldVertical className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={collapseAll}
                title={t("tool_json_collapse_all")}
              >
                <FoldVertical className="h-3.5 w-3.5" />
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
          </div>
          <div className="min-h-[360px] resize-y overflow-auto rounded-md border border-border bg-background-secondary px-3 py-2.5">
            <JsonTree
              value={parsed.ok ? parsed.value : undefined}
              error={parsed.ok ? null : parsed.error}
              expandSignal={expandSignal}
              collapseSignal={collapseSignal}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
