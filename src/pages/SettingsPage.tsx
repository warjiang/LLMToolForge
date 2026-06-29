import { Monitor, Moon, Sun, RefreshCw, CheckCircle2, AlertCircle, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useThemeStore, type Theme } from "@/store/theme";
import { useLocaleStore, type Language } from "@/store/locale";
import { useUpdater } from "@/lib/useUpdater";

export function SettingsPage() {
  const { t } = useTranslation("pages");
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const language = useLocaleStore((s) => s.language);
  const setLanguage = useLocaleStore((s) => s.setLanguage);
  const { state: update, check, install } = useUpdater();

  const themeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "light", label: t("light_theme"), icon: Sun },
    { value: "dark", label: t("dark_theme"), icon: Moon },
  ];

  const languageOptions: { value: Language; label: string }[] = [
    { value: "zh", label: t("lang_zh") },
    { value: "en", label: t("lang_en") },
  ];

  return (
    <div>
      <PageHeader title={t("settings_title")} description={t("settings_description")} />

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

      <Card className="mt-5 p-5">
        <h3 className="text-heading-16">{t("about_title")}</h3>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-copy-14 text-foreground">
              {t("current_version")}
              <span className="ml-2 font-mono text-muted-foreground">
                {update.currentVersion || "—"}
              </span>
            </p>
            <div className="mt-1 flex items-center gap-1.5 text-label-13">
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
          </div>
          {update.phase === "available" ? (
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
          )}
        </div>
      </Card>
    </div>
  );
}
