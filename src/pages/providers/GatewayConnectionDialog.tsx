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
import { useGatewayStore } from "@/store";
import type { GatewayConnection, GatewayProvider, ProviderMeta } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: ProviderMeta & { id: GatewayProvider };
  editing: GatewayConnection | null;
}

const PLACEHOLDER: Record<GatewayProvider, string> = {
  "new-api": "https://your-new-api-host/v1",
  litellm: "https://your-litellm-host/v1",
  dmxapi: "https://www.dmxapi.cn/v1",
};

/** Default Base URL prefilled when creating a connection (host is fixed). */
const DEFAULT_BASE_URL: Partial<Record<GatewayProvider, string>> = {
  dmxapi: "https://www.dmxapi.cn/v1",
};

export function GatewayConnectionDialog({
  open,
  onOpenChange,
  provider,
  editing,
}: Props) {
  const { t } = useTranslation("pages");
  const add = useGatewayStore((s) => s.add);
  const edit = useGatewayStore((s) => s.edit);
  const [form, setForm] = useState({ name: "", baseUrl: "", apiKey: "" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setForm(
        editing
          ? {
              name: editing.name,
              baseUrl: editing.baseUrl,
              apiKey: editing.apiKey,
            }
          : {
              name: "",
              baseUrl: DEFAULT_BASE_URL[provider.id] ?? "",
              apiKey: "",
            }
      );
    }
  }, [open, editing, provider.id]);

  const submit = async () => {
    if (!form.name.trim()) return setError(t("gw_name_required"));
    if (!form.baseUrl.trim()) return setError(t("gw_base_url_required"));
    if (!form.apiKey.trim()) return setError(t("gw_api_key_required"));

    const payload = {
      name: form.name.trim(),
      provider: provider.id,
      baseUrl: form.baseUrl.trim().replace(/\/+$/, ""),
      apiKey: form.apiKey.trim(),
    };

    if (editing) await edit(editing.id, payload);
    else await add(payload);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? t("gw_edit_title", { label: provider.label }) : t("gw_create_title", { label: provider.label })}
          </DialogTitle>
          <DialogDescription>
            {t("gw_dialog_desc")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="gw-name">{t("name", { ns: "common" })}</Label>
            <Input
              id="gw-name"
              placeholder={t("gw_name_placeholder", { label: provider.label })}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="gw-base">Base URL</Label>
            <Input
              id="gw-base"
              placeholder={PLACEHOLDER[provider.id]}
              autoComplete="off"
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            />
            <p className="text-label-12 text-muted-foreground">
              {t("gw_base_url_hint")}
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="gw-key">API Key</Label>
            <Input
              id="gw-key"
              type="password"
              placeholder="sk-..."
              autoComplete="off"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            />
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
