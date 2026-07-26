import { Lightbulb, Shuffle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { CreativityState } from "./state";

export function CreativityWorkspace({
  state,
  onGenerate,
}: {
  state: CreativityState;
  onGenerate: () => void;
}) {
  const { t } = useTranslation("pages");

  if (!state.prompt) {
    return (
      <Card className="flex min-h-[340px] flex-col items-center justify-center p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <Lightbulb className="h-5 w-5" />
        </div>
        <h3 className="mt-4 text-heading-20">
          {t("creativity_empty_title")}
        </h3>
        <p className="mt-2 max-w-lg text-copy-14 text-muted-foreground">
          {t("creativity_empty_desc")}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-label-12 uppercase tracking-[0.16em] text-muted-foreground">
              {t("creativity_current_prompt")}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {state.prompt.items.map((item, index) => (
                <div key={`${item.text}-${index}`} className="flex items-center gap-3">
                  {index > 0 && (
                    <span className="text-heading-24 text-muted-foreground">
                      +
                    </span>
                  )}
                  <span className="rounded-md border border-border bg-background-secondary px-5 py-3 text-heading-24">
                    {item.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <Button variant="secondary" onClick={onGenerate}>
            <Shuffle className="h-4 w-4" />
            {t("creativity_new_prompt")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
