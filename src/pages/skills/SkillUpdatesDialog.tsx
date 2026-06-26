import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  checkSkillUpdate,
  toSkillPayload,
  type SkillUpdateCheck,
} from "@/lib/skillMarket";
import { useMarketSettingsStore, useSkillStore } from "@/store";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type RowStatus = "checking" | SkillUpdateCheck["state"] | "updating" | "updated";

interface Row extends SkillUpdateCheck {
  status: RowStatus;
}

export function SkillUpdatesDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation("pages");
  const skills = useSkillStore((s) => s.items);
  const editSkill = useSkillStore((s) => s.edit);
  const githubToken = useMarketSettingsStore((s) => s.githubToken);
  const token = githubToken.trim() || undefined;

  const marketSkills = useMemo(
    () => skills.filter((s) => s.sourceType === "github" && s.source),
    [skills]
  );

  const [rows, setRows] = useState<Row[]>([]);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const run = async () => {
      setChecking(true);
      setRows(
        marketSkills.map((skill) => ({ skill, state: "up-to-date", status: "checking" }))
      );
      for (const skill of marketSkills) {
        const result = await checkSkillUpdate(skill, token);
        if (cancelled) return;
        setRows((prev) =>
          prev.map((r) =>
            r.skill.id === skill.id
              ? { ...result, status: result.state }
              : r
          )
        );
      }
      if (!cancelled) setChecking(false);
    };
    void run();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const updateOne = async (row: Row) => {
    if (!row.detail) return;
    setRows((prev) =>
      prev.map((r) => (r.skill.id === row.skill.id ? { ...r, status: "updating" } : r))
    );
    try {
      const payload = toSkillPayload(row.detail, row.skill);
      await editSkill(row.skill.id, payload);
      setRows((prev) =>
        prev.map((r) =>
          r.skill.id === row.skill.id ? { ...r, status: "updated" } : r
        )
      );
    } catch {
      setRows((prev) =>
        prev.map((r) =>
          r.skill.id === row.skill.id
            ? { ...r, status: "error", error: t("skill_update_failed") }
            : r
        )
      );
    }
  };

  const updatable = rows.filter((r) => r.status === "update-available");

  const updateAll = async () => {
    for (const row of updatable) {
      await updateOne(row);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("skill_updates_title")}</DialogTitle>
          <DialogDescription>{t("skill_updates_desc")}</DialogDescription>
        </DialogHeader>

        {marketSkills.length === 0 ? (
          <p className="py-6 text-center text-label-13 text-muted-foreground">
            {t("skill_updates_none")}
          </p>
        ) : (
          <div className="grid max-h-[48vh] gap-2 overflow-y-auto pr-1">
            {rows.map((row) => (
              <UpdateRow key={row.skill.id} row={row} onUpdate={() => updateOne(row)} />
            ))}
          </div>
        )}

        <DialogFooter>
          <div className="mr-auto flex items-center gap-2 text-label-12 text-muted-foreground">
            {checking && <Loader2 className="h-4 w-4 animate-spin" />}
            {checking
              ? t("skill_updates_checking")
              : t("skill_updates_summary", { count: updatable.length })}
          </div>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("close", { ns: "common" })}
          </Button>
          <Button
            disabled={checking || updatable.length === 0}
            onClick={updateAll}
          >
            <Download className="h-4 w-4" />
            {t("skill_update_all")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UpdateRow({ row, onUpdate }: { row: Row; onUpdate: () => void }) {
  const { t } = useTranslation("pages");
  const { skill, status, error } = row;

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-label-13 font-medium">{skill.name}</span>
          <StatusBadge status={status} />
        </div>
        <p className="mt-0.5 truncate text-label-12 text-muted-foreground">
          {skill.source}
        </p>
        {status === "error" && error && (
          <p className="mt-1 text-label-12 text-destructive">{error}</p>
        )}
      </div>
      {status === "update-available" && (
        <Button size="sm" onClick={onUpdate}>
          <Download className="h-4 w-4" />
          {t("skill_update_action")}
        </Button>
      )}
      {status === "updating" && (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: RowStatus }) {
  const { t } = useTranslation("pages");
  if (status === "checking") {
    return (
      <Badge variant="outline">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t("skill_updates_checking_short")}
      </Badge>
    );
  }
  if (status === "up-to-date") {
    return (
      <Badge variant="success">
        <CheckCircle2 className="h-3 w-3" />
        {t("skill_updates_up_to_date")}
      </Badge>
    );
  }
  if (status === "update-available") {
    return (
      <Badge variant="warning">
        <RefreshCw className="h-3 w-3" />
        {t("skill_updates_available")}
      </Badge>
    );
  }
  if (status === "updated") {
    return (
      <Badge variant="success">
        <CheckCircle2 className="h-3 w-3" />
        {t("skill_update_done")}
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge variant="destructive">
        <AlertCircle className="h-3 w-3" />
        {t("skill_updates_error")}
      </Badge>
    );
  }
  return null;
}
