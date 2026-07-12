import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  RefreshCw,
  UploadCloud,
  DownloadCloud,
  CheckCircle2,
  AlertCircle,
  CloudCog,
  ShieldCheck,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { useSyncStore } from "@/store/sync";
import { isTauri } from "@/lib/utils";

export function StorageSyncCard() {
  const { t } = useTranslation("pages");
  const config = useSyncStore((s) => s.config);
  const passphrase = useSyncStore((s) => s.passphrase);
  const phase = useSyncStore((s) => s.phase);
  const error = useSyncStore((s) => s.error);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const setConfig = useSyncStore((s) => s.setConfig);
  const setPassphrase = useSyncStore((s) => s.setPassphrase);
  const isConfigured = useSyncStore((s) => s.isConfigured);
  const test = useSyncStore((s) => s.test);
  const sync = useSyncStore((s) => s.sync);
  const restore = useSyncStore((s) => s.restore);

  const [confirmRestore, setConfirmRestore] = useState(false);
  const desktop = isTauri();
  const busy =
    phase === "testing" || phase === "syncing" || phase === "restoring";
  const ready = isConfigured() && desktop && !busy;

  const statusText = () => {
    switch (phase) {
      case "testing":
        return t("sync_testing");
      case "syncing":
        return t("sync_syncing");
      case "restoring":
        return t("sync_restoring");
      default:
        return null;
    }
  };

  return (
    <Card className="mt-5 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-muted-foreground">
          <CloudCog className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-heading-16">{t("sync_title")}</h3>
          <p className="mt-1 text-copy-14 text-muted-foreground">
            {t("sync_description")}
          </p>
        </div>
      </div>

      {!desktop && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-label-13 text-muted-foreground">
          <AlertCircle className="h-3.5 w-3.5" />
          {t("sync_desktop_only")}
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
        <Field label={t("sync_endpoint")}>
          <Input
            value={config.endpoint ?? ""}
            placeholder={t("sync_endpoint_ph")}
            onChange={(e) => setConfig({ endpoint: e.target.value })}
          />
        </Field>
        <Field label={t("sync_region")}>
          <Input
            value={config.region}
            onChange={(e) => setConfig({ region: e.target.value })}
          />
        </Field>
        <Field label={t("sync_bucket")}>
          <Input
            value={config.bucket}
            onChange={(e) => setConfig({ bucket: e.target.value })}
          />
        </Field>
        <Field label={t("sync_prefix")}>
          <Input
            value={config.prefix}
            onChange={(e) => setConfig({ prefix: e.target.value })}
          />
        </Field>
        <Field label={t("sync_access_key")}>
          <Input
            value={config.accessKeyId}
            onChange={(e) => setConfig({ accessKeyId: e.target.value })}
          />
        </Field>
        <Field label={t("sync_secret_key")}>
          <PasswordInput
            value={config.secretAccessKey}
            onChange={(e) => setConfig({ secretAccessKey: e.target.value })}
          />
        </Field>

        <Field label={t("sync_passphrase")} className="sm:col-span-2">
          <PasswordInput
            value={passphrase}
            placeholder={t("sync_passphrase_ph")}
            onChange={(e) => setPassphrase(e.target.value)}
          />
          <p className="mt-1.5 flex items-start gap-1.5 text-label-13 text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t("sync_passphrase_hint")}
          </p>
        </Field>

        <div className="flex h-9 items-center justify-between gap-3 rounded-md border border-border px-3 sm:col-span-2">
          <Label className="text-copy-14">{t("sync_path_style")}</Label>
          <Switch
            checked={config.pathStyle}
            onCheckedChange={(v) => setConfig({ pathStyle: v })}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => test()} disabled={!desktop || busy}>
          <RefreshCw className={`h-4 w-4 ${phase === "testing" ? "animate-spin" : ""}`} />
          {t("sync_test")}
        </Button>
        <Button onClick={() => sync()} disabled={!ready}>
          <UploadCloud className="h-4 w-4" />
          {t("sync_now")}
        </Button>
        <Button
          variant="secondary"
          onClick={() => setConfirmRestore(true)}
          disabled={!ready}
        >
          <DownloadCloud className="h-4 w-4" />
          {t("sync_restore")}
        </Button>
      </div>

      <div className="mt-3 text-label-13">
        {busy && (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            {statusText()}
          </span>
        )}
        {!busy && phase === "success" && (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t("sync_success")}
          </span>
        )}
        {!busy && phase === "error" && error && (
          <span className="flex items-center gap-1.5 text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />
            {error}
          </span>
        )}
        {!busy && phase !== "error" && (
          <p className="mt-1 text-muted-foreground">
            {t("sync_last_synced")}:{" "}
            <span className="font-mono">
              {lastSyncedAt
                ? new Date(lastSyncedAt).toLocaleString()
                : t("sync_never")}
            </span>
          </p>
        )}
        {!isConfigured() && desktop && (
          <p className="mt-1 text-muted-foreground">{t("sync_not_configured")}</p>
        )}
      </div>

      <ConfirmDialog
        open={confirmRestore}
        onOpenChange={setConfirmRestore}
        title={t("sync_restore_confirm_title")}
        description={t("sync_restore_confirm_desc")}
        confirmLabel={t("sync_restore_confirm_ok")}
        onConfirm={() => {
          setConfirmRestore(false);
          void restore();
        }}
      />
    </Card>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-label-13 text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
