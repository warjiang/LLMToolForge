import { useState } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  PROVIDER_METAS,
  type GatewayProvider,
  type ProviderKind,
  type ProviderMeta,
} from "@/types";
import { isLiveRequestSupported } from "@/lib/http";
import { VolcengineProviders } from "./VolcengineProviders";
import { GatewayProviders } from "./GatewayProviders";
import { ManualKeyProviders } from "./ManualKeyProviders";

export function ProvidersPage() {
  const [active, setActive] = useState<ProviderKind>("volcengine");
  const activeMeta =
    PROVIDER_METAS.find((p) => p.id === active) ?? PROVIDER_METAS[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0">
        <PageHeader
          title="模型接入"
          description="统一管理各模型 provider 的接入：火山引擎、New API、LiteLLM、DMXAPI 以及自定义 API Key。新增接入时请先选择 provider。"
        />

        <SegmentedControl
          aria-label="选择 provider"
          value={active}
          onChange={setActive}
          options={PROVIDER_METAS.map((p) => ({ value: p.id, label: p.label }))}
        />

        {!isLiveRequestSupported() && (
          <div className="mt-4 rounded-sm border border-amber-200 bg-amber-50 px-4 py-2.5 text-label-13 text-amber-900">
            浏览器开发模式下，跨域请求会被拦截。请在桌面应用（pnpm tauri:dev）中使用拉取功能。
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
