import { useCallback, useRef, useState, type CSSProperties } from "react";
import { Check, Clipboard, Copy, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ResizeHandle } from "@/components/common/ResizeHandle";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MarkdownMessage } from "@/components/agent/MarkdownMessage";
import {
  clampMarkdownInputPaneWidth,
  MARKDOWN_DEFAULT_INPUT_WIDTH,
  MARKDOWN_TOOL_LAYOUT,
} from "@/lib/markdownTool";

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
  const panesRef = useRef<HTMLDivElement | null>(null);
  const resizeStartWidthRef = useRef(0);
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [inputPaneWidth, setInputPaneWidth] = useState<number | null>(null);

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

  const startResize = useCallback(() => {
    const containerWidth = panesRef.current?.clientWidth ?? 0;
    resizeStartWidthRef.current =
      inputPaneWidth ?? containerWidth * MARKDOWN_DEFAULT_INPUT_WIDTH;
  }, [inputPaneWidth]);

  const handleResize = useCallback((deltaX: number) => {
    const containerWidth = panesRef.current?.clientWidth ?? 0;
    if (!containerWidth) return;
    setInputPaneWidth(
      clampMarkdownInputPaneWidth(resizeStartWidthRef.current + deltaX, containerWidth)
    );
  }, []);

  const paneStyle = {
    "--markdown-input-width":
      inputPaneWidth === null
        ? `${MARKDOWN_DEFAULT_INPUT_WIDTH * 100}%`
        : `${inputPaneWidth}px`,
  } as CSSProperties;

  return (
    <div className={MARKDOWN_TOOL_LAYOUT.root}>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onClick={() => setInput(SAMPLE)}>
          {t("tool_fill_sample")}
        </Button>
      </div>

      <div ref={panesRef} className={MARKDOWN_TOOL_LAYOUT.panes} style={paneStyle}>
        <div className={`${MARKDOWN_TOOL_LAYOUT.pane} ${MARKDOWN_TOOL_LAYOUT.leftPane}`}>
          <div className="flex shrink-0 items-center justify-between">
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
            className={MARKDOWN_TOOL_LAYOUT.editor}
          />
        </div>

        <ResizeHandle
          className={MARKDOWN_TOOL_LAYOUT.handle}
          title={t("tool_markdown_preview")}
          onStart={startResize}
          onDrag={handleResize}
          onReset={() => setInputPaneWidth(null)}
        />

        <div className={`${MARKDOWN_TOOL_LAYOUT.pane} ${MARKDOWN_TOOL_LAYOUT.rightPane}`}>
          <div className="flex shrink-0 items-center justify-between">
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
          <div className={MARKDOWN_TOOL_LAYOUT.preview}>
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
