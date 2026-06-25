import { useState, type ReactNode } from "react";
import { ArrowRightLeft, Check, Clipboard, Copy, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
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
  inputLabel,
  outputLabel,
  inputPlaceholder,
  actions,
  options,
  onSwap,
  outputMono = true,
}: ToolPanelProps) {
  const { t } = useTranslation("common");
  const resolvedInputLabel = inputLabel ?? t("input");
  const resolvedOutputLabel = outputLabel ?? t("output");
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
            <Label>{resolvedInputLabel}</Label>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={paste}
                title={t("paste")}
              >
                <Clipboard className="h-3.5 w-3.5" />
                {t("paste")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onInputChange("")}
                title={t("clear")}
                disabled={!input}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("clear")}
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
            <Label>{resolvedOutputLabel}</Label>
            <div className="flex items-center gap-1">
              {onSwap && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onSwap}
                  title={t("fill_back")}
                  disabled={!output}
                >
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  {t("fill_back")}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={copyOutput}
                disabled={!output}
                title={t("copy")}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copied ? t("copied") : t("copy")}
              </Button>
            </div>
          </div>
          <Textarea
            value={error ? "" : output}
            readOnly
            spellCheck={false}
            placeholder={t("result_placeholder")}
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
