import { Monitor } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { BrowserPreview } from "@/components/agent/BrowserPreview";
import { isTauri } from "@/lib/utils";

export function BrowserPage() {
  const { t } = useTranslation("pages");

  if (!isTauri()) {
    return (
      <div>
        <PageHeader
          title={t("browser_title")}
          description={t("browser_description")}
        />
        <EmptyState
          icon={Monitor}
          title={t("browser_desktop_only_title")}
          description={t("browser_desktop_only_desc")}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t("browser_title")}
        description={t("browser_description")}
      />
      <BrowserPreview showQuickLinks className="min-h-0 flex-1" />
    </div>
  );
}
