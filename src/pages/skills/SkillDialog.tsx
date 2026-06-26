import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Boxes, CheckCircle2, FileText, UploadCloud } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { SKILL_SYNC_MODES, SKILL_TARGETS } from "@/lib/skillTargets";
import { useSkillStore } from "@/store";
import type { Skill, SkillAgentKey, SkillSyncMode } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Skill | null;
}

const empty = {
  name: "",
  description: "",
  tags: "",
  content: "",
  enabled: true,
  agentKeys: [] as SkillAgentKey[],
  syncMode: "copy" as SkillSyncMode,
};

function parseTags(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[,，\s]+/)
        .map((t) => t.trim())
        .filter(Boolean)
    )
  );
}

export function SkillDialog({ open, onOpenChange, editing }: Props) {
  const { t } = useTranslation("pages");
  const add = useSkillStore((s) => s.add);
  const edit = useSkillStore((s) => s.edit);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setForm(
        editing
          ? {
              name: editing.name,
              description: editing.description,
              tags: (editing.tags ?? []).join(", "),
              content: editing.content ?? "",
              enabled: editing.enabled,
              agentKeys: editing.agentKeys ?? [],
              syncMode: editing.syncMode ?? "copy",
            }
          : empty
      );
    }
  }, [open, editing]);

  const submit = async () => {
    if (!form.name.trim()) return setError(t("skill_name_required"));

    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      tags: parseTags(form.tags),
      content: form.content.trim() || undefined,
      enabled: form.enabled,
      agentKeys: form.agentKeys,
      syncMode: form.syncMode,
    };

    if (editing) await edit(editing.id, payload);
    else await add(payload);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? t("skill_edit_title") : t("skill_create_title")}
          </DialogTitle>
          <DialogDescription>
            {t("skill_dialog_desc")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[68vh] gap-4 overflow-y-auto pr-1">
          <DialogSection
            icon={<Boxes className="h-4 w-4" />}
            title={t("skill_section_identity")}
            description={t("skill_section_identity_desc")}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="sk-name">{t("name", { ns: "common" })}</Label>
                <Input
                  id="sk-name"
                  placeholder={t("skill_name_placeholder")}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="sk-tags">{t("skill_tags_label")}</Label>
                <Input
                  id="sk-tags"
                  placeholder={t("skill_tags_placeholder")}
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sk-desc">{t("skill_description_label")}</Label>
              <Textarea
                id="sk-desc"
                className="min-h-[84px]"
                placeholder={t("skill_description_placeholder")}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </div>
          </DialogSection>

          <DialogSection
            icon={<UploadCloud className="h-4 w-4" />}
            title={t("skill_section_deployment")}
            description={t("skill_section_deployment_desc")}
          >
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <Label>{t("skill_agent_targets")}</Label>
                <Badge variant="outline">
                  {t("skill_targets_count", { count: form.agentKeys.length })}
                </Badge>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                {SKILL_TARGETS.map((target) => {
                  const selected = form.agentKeys.includes(target.key);
                  return (
                    <Button
                      key={target.key}
                      type="button"
                      variant={selected ? "secondary" : "ghost"}
                      className="h-9 justify-start overflow-hidden"
                      onClick={() =>
                        setForm({
                          ...form,
                          agentKeys: toggleKey(form.agentKeys, target.key),
                        })
                      }
                    >
                      {selected ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-muted" />
                      )}
                      <span className="truncate">{target.name}</span>
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>{t("skill_sync_mode_label")}</Label>
                <Select
                  value={form.syncMode}
                  onValueChange={(syncMode) =>
                    setForm({ ...form, syncMode: syncMode as SkillSyncMode })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SKILL_SYNC_MODES.map((mode) => (
                      <SelectItem key={mode.value} value={mode.value}>
                        {t(mode.label, { ns: "common" })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between rounded-sm border border-border bg-background-secondary px-3 py-2.5">
                <div className="min-w-0 space-y-0.5">
                  <Label>{t("enabled", { ns: "common" })}</Label>
                  <p className="text-label-12 text-muted-foreground">
                    {t("skill_disabled_hint")}
                  </p>
                </div>
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(v) => setForm({ ...form, enabled: v })}
                />
              </div>
            </div>
          </DialogSection>

          <DialogSection
            icon={<FileText className="h-4 w-4" />}
            title={t("skill_section_content")}
            description={t("skill_section_content_desc")}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="sk-content">{t("skill_content_label")}</Label>
              <Textarea
                id="sk-content"
                className="min-h-[150px] font-mono text-label-12"
                placeholder={t("skill_content_placeholder")}
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
              />
            </div>
          </DialogSection>

          {error && (
            <p className="rounded-sm border border-destructive/30 bg-red-100 px-3 py-2 text-label-13 text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("cancel", { ns: "common" })}
          </Button>
          <Button onClick={submit}>{editing ? t("save", { ns: "common" }) : t("create", { ns: "common" })}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogSection({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-background-secondary p-3">
      <div className="mb-3 flex items-start gap-2">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-card text-muted-foreground shadow-geist-sm">
          {icon}
        </div>
        <div className="min-w-0">
          <h3 className="text-heading-14">{title}</h3>
          <p className="mt-0.5 text-label-12 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function toggleKey(keys: SkillAgentKey[], key: SkillAgentKey): SkillAgentKey[] {
  return keys.includes(key)
    ? keys.filter((item) => item !== key)
    : [...keys, key];
}
