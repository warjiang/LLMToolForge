import { useState } from "react";
import { Check, Copy, StickyNote } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/**
 * Read-only display of a provider/credential note (free-form memo).
 * Renders nothing when there is no note. Preserves line breaks and offers
 * a one-click copy for quick sharing of the saved info (URLs, base_url, keys…).
 */
export function ProviderNote({ note }: { note?: string }) {
  const { t } = useTranslation("pages");
  const [copied, setCopied] = useState(false);

  const value = note?.trim();
  if (!value) return null;

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="mb-4 rounded-sm border border-border bg-secondary/30 px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-label-12 font-medium text-muted-foreground">
          <StickyNote className="h-3.5 w-3.5" />
          {t("provider_note_heading")}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={copy}
          aria-label={t("provider_note_copy")}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {t("provider_note_copy")}
        </Button>
      </div>
      <p className="whitespace-pre-wrap break-words text-label-13 text-foreground">
        {value}
      </p>
    </div>
  );
}
