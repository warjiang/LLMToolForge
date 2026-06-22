import { useState, type ReactNode } from "react";
import { ArrowRightLeft, Check, Clipboard, Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface ToolPanelProps {
  input: string;
  onInputChange: (v: string) => void;
  output: string;
  error?: string | null;
  inputLabel?: string;
  outputLabel?: string;
  inputPlaceholder?: string;
  /** Controls in the action bar between the two panes (e.g. Encode/Decode). */
  actions?: ReactNode;
  /** Optional extra options row rendered above the panes. */
  options?: ReactNode;
  /** When provided, shows a swap button moving output back into input. */
  onSwap?: () => void;
  outputMono?: boolean;
}

export function ToolPanel({
  input,
  onInputChange,
  output,
  error,
  inputLabel = "输入",
  outputLabel = "输出",
  inputPlaceholder,
  actions,
  options,
  onSwap,
  outputMono = true,
}: ToolPanelProps) {
  const [copied, setCopied] = useState(false);

  const copyOutput = async () => {
    if (!output) return;
    await navigator.clipboard?.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard?.readText();
      if (text) onInputChange(text);
    } catch {
      /* clipboard read may be blocked; ignore */
    }
  };

  return (
    <div className="space-y-4">
      {(actions || options) && (
        <div className="flex flex-wrap items-center gap-3">
          {actions}
          {options && (
            <div className="ml-auto flex items-center gap-3">{options}</div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>{inputLabel}</Label>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={paste}
                title="粘贴"
              >
                <Clipboard className="h-3.5 w-3.5" />
                粘贴
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onInputChange("")}
                title="清空"
                disabled={!input}
              >
                <Trash2 className="h-3.5 w-3.5" />
                清空
              </Button>
            </div>
          </div>
          <Textarea
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            placeholder={inputPlaceholder}
            spellCheck={false}
            className="min-h-[320px] resize-y font-mono text-copy-13 leading-relaxed"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>{outputLabel}</Label>
            <div className="flex items-center gap-1">
              {onSwap && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onSwap}
                  title="将输出作为输入"
                  disabled={!output}
                >
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  回填
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={copyOutput}
                disabled={!output}
                title="复制"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copied ? "已复制" : "复制"}
              </Button>
            </div>
          </div>
          <Textarea
            value={error ? "" : output}
            readOnly
            spellCheck={false}
            placeholder="结果将显示在这里"
            className={cn(
              "min-h-[320px] resize-y bg-background-secondary text-copy-13 leading-relaxed",
              outputMono && "font-mono"
            )}
          />
          {error && (
            <p className="text-label-13 text-destructive">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
