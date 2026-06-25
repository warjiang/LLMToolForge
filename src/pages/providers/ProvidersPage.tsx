import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/common/PageHeader";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  PROVIDER_METAS,
  type GatewayProvider,
  type ProviderKind,
  type ProviderMeta,
} from "@/types";
import { isLiveRequestSupported } from "@/lib/http";
import { ProviderIconLabel } from "@/components/common/ProviderModelIcon";
import { VolcengineProviders } from "./VolcengineProviders";
import { GatewayProviders } from "./GatewayProviders";
import { ManualKeyProviders } from "./ManualKeyProviders";

export function ProvidersPage() {
  const { t } = useTranslation("pages");
  const [active, setActive] = useState<ProviderKind>("volcengine");
  const activeMeta =
    PROVIDER_METAS.find((p) => p.id === active) ?? PROVIDER_METAS[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0">
        <PageHeader
          title={t("providers_title")}
          description={t("providers_desc")}
        />

        <SegmentedControl
          aria-label={t("providers_select_label")}
          value={active}
          onChange={setActive}
          options={PROVIDER_METAS.map((p) => ({
            value: p.id,
            label: <ProviderIconLabel provider={p.id}>{p.label.startsWith("provider_label_") ? t(p.label) : p.label}</ProviderIconLabel>,
          }))}
        />

        {!isLiveRequestSupported() && (
          <div className="mt-4 rounded-sm border border-amber-200 bg-amber-50 px-4 py-2.5 text-label-13 text-amber-900">
            {t("providers_cors_warning")}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col pt-4">
        {activeMeta.kind === "volc" ? (
          <VolcengineProviders />
        ) : activeMeta.kind === "manual" ? (
          <ManualKeyProviders />
        ) : (
          <GatewayProviders
            provider={activeMeta as ProviderMeta & { id: GatewayProvider }}
          />
        )}
      </div>
    </div>
  );
}
