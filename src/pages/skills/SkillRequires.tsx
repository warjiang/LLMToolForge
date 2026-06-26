import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { checkSkillBins, type BinStatus } from "@/lib/skillBins";
import type { SkillRequirements } from "@/types";

/**
 * Render a skill's declared external tool requirements with a live
 * present/missing indication. Renders nothing when the skill declares none.
 */
export function SkillRequires({
  requires,
  className,
}: {
  requires?: SkillRequirements;
  className?: string;
}) {
  const { t } = useTranslation("pages");
  const bins = requires?.bins ?? [];
  const [statuses, setStatuses] = useState<BinStatus[]>(
    bins.map((name) => ({ name, found: false }))
  );

  useEffect(() => {
    if (bins.length === 0) return;
    let active = true;
    checkSkillBins(requires)
      .then((res) => {
        if (active) setStatuses(res);
      })
      .catch(() => {
        /* leave optimistic "missing" state */
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bins.join(",")]);

  if (bins.length === 0) return null;

  const missing = statuses.filter((s) => !s.found).length;

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1.5 text-label-12 text-muted-foreground">
        <Terminal className="h-3.5 w-3.5" />
        <span>{t("skill_requires_label")}</span>
        {missing > 0 && (
          <Badge variant="warning">
            {t("skill_requires_missing", { count: missing })}
          </Badge>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5 rounded-sm border border-border bg-background-secondary p-2">
        {statuses.map((s) => (
          <Badge
            key={s.name}
            variant={s.found ? "success" : "warning"}
            title={s.found ? s.path : t("skill_requires_not_found")}
            className="gap-1"
          >
            {s.found ? (
              <Check className="h-3 w-3" />
            ) : (
              <AlertTriangle className="h-3 w-3" />
            )}
            <span className="font-mono">{s.name}</span>
          </Badge>
        ))}
      </div>
    </div>
  );
}
