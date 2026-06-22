import { useState } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { cn } from "@/lib/utils";
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
    <div>
      <PageHeader
        title="模型接入"
        description="统一管理各模型 provider 的接入：火山引擎、New API、LiteLLM、DMXAPI 以及自定义 API Key。新增接入时请先选择 provider。"
      />

      <div className="mb-5 inline-flex rounded-md border border-border bg-background-secondary p-0.5">
        {PROVIDER_METAS.map((p) => (
          <button
            key={p.id}
            onClick={() => setActive(p.id)}
            className={cn(
              "rounded-sm px-3.5 py-1.5 text-label-13 transition-colors",
              active === p.id
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {!isLiveRequestSupported() && (
        <div className="mb-4 rounded-sm border border-amber-200 bg-amber-50 px-4 py-2.5 text-label-13 text-amber-900">
          浏览器开发模式下，跨域请求会被拦截。请在桌面应用（pnpm tauri:dev）中使用拉取功能。
        </div>
      )}

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
  );
}
