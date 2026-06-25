import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useThemeStore, type Theme } from "@/store/theme";
import { useLocaleStore, type Language } from "@/store/locale";

export function SettingsPage() {
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
    </div>
  );
}
