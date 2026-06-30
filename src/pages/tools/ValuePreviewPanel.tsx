import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type SyntaxFormat = "markdown" | "json" | "xml" | "plain";

interface ValuePreviewPanelProps {
  value: unknown;
  onClose: () => void;
}

const FORMAT_OPTIONS: { label: string; value: SyntaxFormat }[] = [
  { label: "Markdown", value: "markdown" },
  { label: "JSON", value: "json" },
  { label: "XML", value: "xml" },
  { label: "Plain Text", value: "plain" },
];

// 简单的 XML 格式化（基础实现）
function formatAsXml(value: unknown): string {
  if (typeof value === "string") {
    return `<root>${escapeXml(value)}</root>`;
  }
  return `<root>${escapeXml(JSON.stringify(value, null, 2))}</root>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderMarkdownPreview(text: string): React.ReactNode {
  // 简单的 markdown 渲染（列表、标题、加粗等）
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 标题
    if (line.startsWith("# ")) {
      elements.push(
        <h1 key={`h1-${i}`} className="text-lg font-bold mt-3 mb-1">
          {line.slice(2)}
        </h1>
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <h2 key={`h2-${i}`} className="text-base font-bold mt-2 mb-1">
          {line.slice(3)}
        </h2>
      );
    } else if (line.startsWith("### ")) {
      elements.push(
        <h3 key={`h3-${i}`} className="text-sm font-bold mt-1">
          {line.slice(4)}
        </h3>
      );
    }
    // 列表
    else if (line.startsWith("- ")) {
      elements.push(
        <div key={`li-${i}`} className="ml-4 mb-1">
          • {line.slice(2)}
        </div>
      );
    }
    // 代码块（检测 ``` 包装）
    else if (line.startsWith("```")) {
      // 跳过代码块标记
      continue;
    }
    // 普通文本
    else if (line.trim()) {
      elements.push(
        <p key={`p-${i}`} className="mb-2 leading-relaxed whitespace-pre-wrap break-words">
          {line}
        </p>
      );
    } else {
      elements.push(<div key={`br-${i}`} className="mb-2" />);
    }
  }

  return elements;
}

export function ValuePreviewPanel({ value, onClose }: ValuePreviewPanelProps) {
  const tc = useTranslation("common").t;
  const [format, setFormat] = useState<SyntaxFormat>("markdown");
  const [copied, setCopied] = useState(false);

  const contentString = useMemo(() => {
    switch (format) {
      case "json":
        return JSON.stringify(value, null, 2);
      case "xml":
        return formatAsXml(value);
      case "plain":
        return typeof value === "string" ? value : JSON.stringify(value);
      case "markdown":
      default:
        return typeof value === "string" ? value : JSON.stringify(value, null, 2);
    }
  }, [value, format]);

  const copy = async () => {
    await navigator.clipboard?.writeText(contentString);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full">
        {/* 标题栏 - 标题、Select、复制按钮、关闭按钮在一行 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0 gap-3">
          <h3 className="font-semibold text-sm flex-shrink-0">详情预览</h3>
          <Select value={format} onValueChange={(v) => setFormat(v as SyntaxFormat)}>
            <SelectTrigger className="w-32 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FORMAT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={copy}
                className="h-8 w-8 p-0"
              >
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {copied ? tc("copied") : tc("copy")}
            </TooltipContent>
          </Tooltip>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-lg leading-none flex-shrink-0"
          >
            ×
          </button>
        </div>

        {/* 内容展示区 */}
        <div className="flex-1 overflow-auto px-4 py-3">
          {format === "markdown" && typeof value === "string" ? (
            <div className="prose prose-sm max-w-none dark:prose-invert text-xs">
              {renderMarkdownPreview(value)}
            </div>
          ) : (
            <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-words bg-muted/50 p-3 rounded">
              {contentString}
            </pre>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
