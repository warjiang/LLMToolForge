import { useEffect, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  Monitor,
  Moon,
  Sun,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Download,
  Fingerprint,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useThemeStore, type Theme } from "@/store/theme";
import { useLocaleStore, type Language } from "@/store/locale";
import { useDeviceConfigStore } from "@/store/deviceConfig";
import { useUpdater } from "@/lib/useUpdater";
import { StorageSyncCard } from "@/pages/settings/StorageSyncCard";
import {
  isFeatureEnabled,
  validateFeatureConfig,
  type FeatureConfig,
  type FeatureId,
} from "@/lib/deviceConfig";
import { isTauri } from "@/lib/utils";

const FEATURE_UNLOCK_CLICKS = 8;

export function SettingsPage() {
  const { t } = useTranslation("pages");
  const { state: update, check, install } = useUpdater();
  const deviceId = useDeviceConfigStore((s) => s.deviceId);
  const featureConfig = useDeviceConfigStore((s) => s.featureConfig);
  const saveFeatureConfig = useDeviceConfigStore((s) => s.saveFeatureConfig);

  const feature = (id: FeatureId) => isFeatureEnabled(featureConfig, id);

  return (
    <div>
      <PageHeader title={t("settings_title")} description={t("settings_description")} />

      {feature("settings.appearance") && <AppearanceSection />}
      {feature("settings.dataStorage") && <DataStorageSection />}
      {feature("settings.storageSync") && <StorageSyncCard />}

      <AboutSection
        update={update}
        check={check}
        install={install}
        deviceId={deviceId}
        featureConfig={featureConfig}
        onSaveFeatureConfig={saveFeatureConfig}
        showUpdates={feature("settings.updates")}
      />
    </div>
  );
}

function AppearanceSection() {
  const { t } = useTranslation("pages");
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const language = useLocaleStore((s) => s.language);
  const setLanguage = useLocaleStore((s) => s.setLanguage);

  const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "light", label: t("light_theme"), icon: Sun },
    { value: "dark", label: t("dark_theme"), icon: Moon },
  ];

  const languageOptions: { value: Language; label: string }[] = [
    { value: "zh", label: t("lang_zh") },
    { value: "en", label: t("lang_en") },
  ];

  return (
    <Card className="p-5">
      <h3 className="text-heading-16">{t("appearance")}</h3>
      <p className="mt-1 text-copy-14 text-muted-foreground">
        {t("choose_theme")}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {themeOptions.map(({ value, label, icon: Icon }) => (
          <Button
            key={value}
            variant={theme === value ? "primary" : "secondary"}
            onClick={() => setTheme(value)}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Button>
        ))}
        <div className="mx-1 h-5 w-px bg-border" />
        {languageOptions.map(({ value, label }) => (
          <Button
            key={value}
            variant={language === value ? "primary" : "secondary"}
            onClick={() => setLanguage(value)}
          >
            {label}
          </Button>
        ))}
      </div>
    </Card>
  );
}

function DataStorageSection() {
  const { t } = useTranslation("pages");

  return (
    <Card className="mt-5 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-muted-foreground">
          <Monitor className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-heading-16">{t("data_storage")}</h3>
          <p className="mt-1 text-copy-14 text-muted-foreground">
            {t("storage_description")}
          </p>
        </div>
      </div>
    </Card>
  );
}

function AboutSection({
  update,
  check,
  install,
  deviceId,
  featureConfig,
  onSaveFeatureConfig,
  showUpdates,
}: {
  update: ReturnType<typeof useUpdater>["state"];
  check: () => Promise<void>;
  install: () => Promise<void>;
  deviceId: string;
  featureConfig: FeatureConfig;
  onSaveFeatureConfig: (config: FeatureConfig) => Promise<void>;
  showUpdates: boolean;
}) {
  const { t } = useTranslation("pages");
  const [configOpen, setConfigOpen] = useState(false);
  const [versionClicks, setVersionClicks] = useState(0);

  const handleVersionClick = () => {
    const nextClicks = versionClicks + 1;

    if (nextClicks >= FEATURE_UNLOCK_CLICKS) {
      setVersionClicks(0);
      setConfigOpen(true);
      return;
    }

    setVersionClicks(nextClicks);
  };

  return (
    <Card className="mt-5 p-5">
      <h3 className="text-heading-16">{t("about_title")}</h3>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <p className="text-copy-14 text-foreground">
            {t("current_version")}
            <button
              type="button"
              onClick={handleVersionClick}
              className="ml-2 rounded-sm font-mono text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--ring)]"
            >
              {update.currentVersion || "—"}
            </button>
          </p>
          <p className="flex min-w-0 items-center gap-1.5 text-copy-14 text-foreground">
            <Fingerprint className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {t("device_id")}
            <span className="min-w-0 break-all font-mono text-muted-foreground">
              {deviceId || t("device_id_loading")}
            </span>
          </p>
          {showUpdates && <UpdateStatus update={update} />}
        </div>

        {showUpdates && (
          update.phase === "available" ? (
            <Button onClick={install}>
              <Download className="h-4 w-4" />
              {t("update_install_now")}
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={check}
              disabled={update.phase === "checking" || update.phase === "downloading"}
            >
              <RefreshCw className="h-4 w-4" />
              {t("check_for_updates")}
            </Button>
          )
        )}
      </div>

      <FeatureConfigDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        config={featureConfig}
        onSave={onSaveFeatureConfig}
      />
    </Card>
  );
}

function UpdateStatus({
  update,
}: {
  update: ReturnType<typeof useUpdater>["state"];
}) {
  const { t } = useTranslation("pages");

  return (
    <div className="flex items-center gap-1.5 text-label-13">
      {update.phase === "checking" && (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          {t("update_checking")}
        </span>
      )}
      {update.phase === "uptodate" && (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {t("update_uptodate")}
        </span>
      )}
      {update.phase === "available" && (
        <span className="flex items-center gap-1.5 text-foreground">
          <Download className="h-3.5 w-3.5" />
          {t("update_new_found", { version: update.newVersion })}
        </span>
      )}
      {update.phase === "error" && (
        <span className="flex items-center gap-1.5 text-destructive">
          <AlertCircle className="h-3.5 w-3.5" />
          {update.error}
        </span>
      )}
    </div>
  );
}

function FeatureConfigDialog({
  open,
  onOpenChange,
  config,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: FeatureConfig;
  onSave: (config: FeatureConfig) => Promise<void>;
}) {
  const { t } = useTranslation("pages");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const shouldRestartAfterSave = !import.meta.env.DEV;

  useEffect(() => {
    if (!open) return;
    setDraft(JSON.stringify(config, null, 2));
    setError(null);
  }, [config, open]);

  const save = async () => {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch {
      setError(t("feature_config_invalid_json"));
      return;
    }

    const validation = validateFeatureConfig(parsed);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    setSaving(true);
    try {
      await onSave(validation.config);
      if (!shouldRestartAfterSave) {
        setSaving(false);
        onOpenChange(false);
      } else if (isTauri()) {
        await relaunch();
      } else {
        window.location.reload();
      }
    } catch (e) {
      setSaving(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl"
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t("feature_config_title")}</DialogTitle>
          <DialogDescription>{t("feature_config_description")}</DialogDescription>
        </DialogHeader>

        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="min-h-[320px] font-mono text-label-13"
        />
        {error && (
          <p className="flex items-center gap-1.5 text-label-13 text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t("cancel_action")}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <RefreshCw className="h-4 w-4 animate-spin" />}
            {t(
              shouldRestartAfterSave
                ? "feature_config_save_restart"
                : "feature_config_save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
