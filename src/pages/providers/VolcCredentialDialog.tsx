import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { useVolcCredentialStore } from "@/store";
import {
  VOLC_DEFAULT_PROJECT,
  VOLC_REGIONS,
  type VolcCredential,
} from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: VolcCredential | null;
}

const empty = {
  name: "",
  accessKey: "",
  secretKey: "",
  region: VOLC_REGIONS[0] as string,
  project: VOLC_DEFAULT_PROJECT,
};

export function VolcCredentialDialog({ open, onOpenChange, editing }: Props) {
  const { t } = useTranslation("pages");
  const add = useVolcCredentialStore((s) => s.add);
  const edit = useVolcCredentialStore((s) => s.edit);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setForm(
        editing
          ? {
              name: editing.name,
              accessKey: editing.accessKey,
              secretKey: editing.secretKey,
              region: editing.region,
              project: editing.project || VOLC_DEFAULT_PROJECT,
            }
          : empty
      );
    }
  }, [open, editing]);

  const submit = async () => {
    if (!form.name.trim()) return setError(t("volc_err_name"));
    if (!form.accessKey.trim()) return setError(t("volc_err_ak"));
    if (!form.secretKey.trim()) return setError(t("volc_err_sk"));

    const payload = {
      name: form.name.trim(),
      accessKey: form.accessKey.trim(),
      secretKey: form.secretKey.trim(),
      region: form.region,
      project: form.project.trim() || VOLC_DEFAULT_PROJECT,
    };

    if (editing) await edit(editing.id, payload);
    else await add({ ...payload, apiKeys: [] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? t("volc_edit_title") : t("volc_create_title")}
          </DialogTitle>
          <DialogDescription>
            {t("volc_dialog_desc")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="vc-name">{t("name", { ns: "common" })}</Label>
            <Input
              id="vc-name"
              placeholder={t("volc_name_placeholder")}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="vc-ak">AccessKey ID</Label>
            <Input
              id="vc-ak"
              placeholder="AKLT..."
              autoComplete="off"
              value={form.accessKey}
              onChange={(e) => setForm({ ...form, accessKey: e.target.value })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="vc-sk">SecretAccessKey</Label>
            <Input
              id="vc-sk"
              type="password"
              placeholder="••••••••"
              autoComplete="off"
              value={form.secretKey}
              onChange={(e) => setForm({ ...form, secretKey: e.target.value })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>{t("volc_region_label")}</Label>
            <Select
              value={form.region}
              onValueChange={(v) => setForm({ ...form, region: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VOLC_REGIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="vc-project">{t("volc_project_label")}</Label>
            <Input
              id="vc-project"
              placeholder="default"
              autoComplete="off"
              value={form.project}
              onChange={(e) => setForm({ ...form, project: e.target.value })}
            />
            <p className="text-label-12 text-muted-foreground">
              {t("volc_project_hint")}
            </p>
          </div>

          {error && <p className="text-label-13 text-destructive">{error}</p>}
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
