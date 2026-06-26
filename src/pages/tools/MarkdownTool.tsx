import { useState } from "react";
import { Check, Clipboard, Copy, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MarkdownMessage } from "@/components/agent/MarkdownMessage";

const SAMPLE = `# Markdown 渲染

支持 **加粗**、*斜体*、~~删除线~~ 与 [链接](https://example.com)。

- 列表项一
- 列表项二

\`\`\`ts
const hello = (name: string) => \`Hello, \${name}\`;
\`\`\`

| 列 A | 列 B |
| ---- | ---- |
| 1    | 2    |

> 引用区块
`;

export function MarkdownTool() {
  const { t } = useTranslation("pages");
  const tc = useTranslation("common").t;
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState(false);

  const paste = async () => {
    try {
      const text = await navigator.clipboard?.readText();
      if (text) setInput(text);
    } catch {
      /* clipboard read may be blocked */
    }
  };

  const copy = async () => {
    if (!input) return;
    await navigator.clipboard?.writeText(input);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onClick={() => setInput(SAMPLE)}>
          {t("tool_fill_sample")}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>{t("tool_markdown_input")}</Label>
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
            placeholder={t("tool_markdown_placeholder")}
            spellCheck={false}
            className="min-h-[320px] resize-y font-mono text-copy-13 leading-relaxed"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>{t("tool_markdown_preview")}</Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={copy}
              disabled={!input}
              title={tc("copy")}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? tc("copied") : tc("copy")}
            </Button>
          </div>
          <div className="min-h-[320px] resize-y overflow-auto rounded-md border border-border bg-background-secondary px-4 py-3">
            {input ? (
              <MarkdownMessage content={input} />
            ) : (
              <p className="text-label-13 text-muted-foreground">
                {tc("result_placeholder")}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
