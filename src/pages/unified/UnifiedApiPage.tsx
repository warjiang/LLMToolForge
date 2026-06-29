import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUnifiedStore } from "@/store/unified";
import {
  type ExposedModel,
  type ModelFeature,
} from "@/lib/unifiedApi";

const IntegrationGuide = lazy(() =>
  import("./IntegrationGuide").then((m) => ({ default: m.IntegrationGuide }))
);
const MonitorPanel = lazy(() =>
  import("./MonitorPanel").then((m) => ({ default: m.MonitorPanel }))
);
const ModelIcon = lazy(() =>
  import("@/components/common/ProviderModelIcon").then((m) => ({
    default: m.ModelIcon,
  }))
);
const ProviderIcon = lazy(() =>
  import("@/components/common/ProviderModelIcon").then((m) => ({
    default: m.ProviderIcon,
  }))
);

const MODEL_LIST_HEIGHT = 400;
const MODEL_ROW_HEIGHT = 36;
const MODEL_GROUP_HEIGHT = 28;
const MODEL_ROW_OVERSCAN = 8;
const MODEL_FEATURES: { value: ModelFeature; label: string }[] = [
  { value: "vision", label: "feature_vision" },
  { value: "image-gen", label: "feature_image_gen" },
  { value: "video-gen", label: "feature_video_gen" },
  { value: "function-call", label: "feature_function_call" },
];
const FEATURE_LABEL: Record<ModelFeature, string> = {
  vision: "feature_vision",
  "image-gen": "feature_image_gen",
  "video-gen": "feature_video_gen",
  "function-call": "feature_function_call",
};

function featureLabel(feature: ModelFeature): string {
  return FEATURE_LABEL[feature] ?? feature;
}

function generateLocalKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `sk-local-${Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function UnifiedTabFallback() {
  return (
    <div className="flex min-h-[220px] items-center justify-center text-label-13 text-muted-foreground">
      Loading...
    </div>
  );
}

function DeferredModelIcon({
  model,
  className,
}: {
  model: string;
  className?: string;
}) {
  const fallback = (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center ${className ?? ""}`}
    />
  );

  return (
    <Suspense fallback={fallback}>
      <ModelIcon model={model} className={className} />
    </Suspense>
  );
}

function LazyOnVisible({
  minHeight,
  onVisible,
  children,
}: {
  minHeight: number;
  onVisible?: () => void;
  children: () => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          onVisible?.();
          observer.disconnect();
        }
      },
      { rootMargin: "280px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [onVisible, visible]);

  return (
    <div ref={ref} style={{ minHeight }}>
      {visible ? children() : null}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useTranslation("common");
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* ignore */
        }
      }}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--ring)]"
      aria-label={label ?? t("copy")}
      title={label ?? t("copy")}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-success" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col px-4 first:pl-0 last:pr-0">
      <span className="font-mono text-heading-16 tabular-nums leading-none text-foreground">
        {value}
      </span>
      <span className="mt-1 text-label-12 text-muted-foreground">{label}</span>
    </div>
  );
}

function DeferredProviderIcon({
  provider,
  className,
}: {
  provider: string;
  className?: string;
}) {
  const fallback = (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center ${className ?? ""}`}
    />
  );

  return (
    <Suspense fallback={fallback}>
      <ProviderIcon provider={provider} className={className} />
    </Suspense>
  );
}

function EndpointRow({
  provider,
  protocol,
  usage,
  url,
}: {
  provider: string;
  protocol: string;
  usage: string;
  url: string;
}) {
  const { t } = useTranslation("pages");
  return (
    <div className="group flex items-center gap-2.5 rounded-md border border-border bg-background/70 px-2.5 py-2 transition-colors duration-150 hover:border-muted-foreground/30">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-secondary">
        <DeferredProviderIcon provider={provider} className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-label-12 text-muted-foreground">
          <span className="font-medium text-foreground">{protocol}</span>
          <span aria-hidden>·</span>
          <span className="truncate">{usage}</span>
        </div>
        <code className="block truncate font-mono text-copy-13 text-foreground">
          {url}
        </code>
      </div>
      <CopyButton text={url} label={t("unified_copy_url", { protocol })} />
    </div>
  );
}

type ModelListRow =
  | { kind: "group"; id: string; connName: string; count: number }
  | { kind: "model"; id: string; model: ExposedModel };

type VirtualRow = ModelListRow & {
  top: number;
  height: number;
};

function buildModelRows(models: ExposedModel[]): ModelListRow[] {
  const counts = new Map<string, number>();
  for (const model of models) {
    counts.set(model.connName, (counts.get(model.connName) ?? 0) + 1);
  }

  const rows: ModelListRow[] = [];
  let currentConn = "";
  for (const model of models) {
    if (model.connName !== currentConn) {
      currentConn = model.connName;
      rows.push({
        kind: "group",
        id: `group:${model.connName}`,
        connName: model.connName,
        count: counts.get(model.connName) ?? 0,
      });
    }
    rows.push({ kind: "model", id: model.id, model });
  }
  return rows;
}

function rowHeight(row: ModelListRow): number {
  return row.kind === "group" ? MODEL_GROUP_HEIGHT : MODEL_ROW_HEIGHT;
}

function firstVisibleIndex(rows: VirtualRow[], scrollTop: number): number {
  let low = 0;
  let high = rows.length - 1;
  let result = rows.length;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (rows[mid].top + rows[mid].height >= scrollTop) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return result;
}

function ModelVirtualTable({
  models,
  disabled,
  onToggle,
}: {
  models: ExposedModel[];
  disabled: Set<string>;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const { t } = useTranslation("pages");
  const [scrollTop, setScrollTop] = useState(0);

  const rows = useMemo(() => buildModelRows(models), [models]);
  const { virtualRows, totalHeight } = useMemo(() => {
    let top = 0;
    const virtualRows = rows.map((row) => {
      const height = rowHeight(row);
      const virtualRow: VirtualRow = { ...row, top, height };
      top += height;
      return virtualRow;
    });
    return { virtualRows, totalHeight: top };
  }, [rows]);

  const visibleRows = useMemo(() => {
    if (virtualRows.length === 0) return [];
    const start = Math.max(
      0,
      firstVisibleIndex(virtualRows, scrollTop) - MODEL_ROW_OVERSCAN
    );
    const endAt = scrollTop + MODEL_LIST_HEIGHT;
    let end = start;
    while (
      end < virtualRows.length &&
      virtualRows[end].top < endAt + MODEL_ROW_OVERSCAN * MODEL_ROW_HEIGHT
    ) {
      end += 1;
    }
    return virtualRows.slice(start, end);
  }, [scrollTop, virtualRows]);

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  return (
    <div
      className="overflow-y-auto"
      style={{ height: MODEL_LIST_HEIGHT }}
      onScroll={handleScroll}
    >
      <div className="relative" style={{ height: totalHeight }}>
        {visibleRows.map((row) =>
          row.kind === "group" ? (
            <div
              key={row.id}
              className="absolute inset-x-0 z-10 flex items-center gap-1.5 bg-card/95 px-4 text-label-12 text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-card/80"
              style={{ top: row.top, height: row.height }}
            >
              <span className="truncate">{row.connName}</span>
              <span className="font-mono tabular-nums text-muted-foreground/60">
                {row.count}
              </span>
            </div>
          ) : (
            <ModelVirtualRow
              key={row.id}
              row={row}
              disabled={disabled}
              onToggle={onToggle}
              copyLabel={t("copy", { ns: "common" })}
            />
          )
        )}
      </div>
    </div>
  );
}

function ModelVirtualRow({
  row,
  disabled,
  onToggle,
  copyLabel,
}: {
  row: Extract<VirtualRow, { kind: "model" }>;
  disabled: Set<string>;
  onToggle: (id: string, enabled: boolean) => void;
  copyLabel: string;
}) {
  const { t } = useTranslation("common");
  const model = row.model;
  const on = !disabled.has(model.id);
  const sameAsId = model.realModel === model.id.split("/").pop();

  return (
    <div
      className="absolute inset-x-0 grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto] items-center gap-3 px-4 transition-colors duration-150 hover:bg-secondary/40"
      style={{ top: row.top, height: row.height }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <DeferredModelIcon model={model.realModel} className="h-4 w-4 shrink-0" />
        <code
          className="truncate font-mono text-copy-13 text-foreground"
          title={model.id}
        >
          {model.id}
        </code>
        <CopyButton text={model.id} label={copyLabel} />
      </div>
      <div className="min-w-0">
        {sameAsId ? (
          <span className="text-label-12 text-muted-foreground/50">-</span>
        ) : (
          <code
            className="block truncate font-mono text-label-12 text-muted-foreground"
            title={model.realModel}
          >
            {model.realModel}
          </code>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap gap-1">
        {model.features.length > 0 ? (
          model.features.map((feature) => (
            <Badge
              key={feature}
              variant="accent"
              className="px-1.5 py-0 text-[10px]"
            >
              {t(featureLabel(feature))}
            </Badge>
          ))
        ) : (
          <span className="text-label-12 text-muted-foreground/50">-</span>
        )}
      </div>
      <div className="flex justify-end">
        <Switch checked={on} onCheckedChange={(enabled) => onToggle(model.id, enabled)} />
      </div>
    </div>
  );
}

function ExposedModelsCard({
  models,
  disabled,
  hydrated,
  hydrating,
  onToggle,
}: {
  models: ExposedModel[];
  disabled: Set<string>;
  hydrated: boolean;
  hydrating: boolean;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const { t } = useTranslation("pages");
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [featureFilter, setFeatureFilter] = useState<"all" | ModelFeature>(
    "all"
  );
  const deferredQuery = useDeferredValue(query);

  const providerOptions = useMemo(
    () => [...new Set(models.map((model) => model.provider))].sort(),
    [models]
  );
  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return models.filter((model) => {
      if (providerFilter !== "all" && model.provider !== providerFilter) {
        return false;
      }
      if (featureFilter !== "all" && !model.features.includes(featureFilter)) {
        return false;
      }
      if (
        q &&
        !model.id.toLowerCase().includes(q) &&
        !model.realModel.toLowerCase().includes(q) &&
        !model.connName.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [models, deferredQuery, providerFilter, featureFilter]);
  const hasFilter =
    query.trim() !== "" || providerFilter !== "all" || featureFilter !== "all";

  const clearFilters = () => {
    setQuery("");
    setProviderFilter("all");
    setFeatureFilter("all");
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-heading-16">{t("unified_exposed_models_title")}</h3>
        </div>
        <p className="hidden text-copy-13 text-muted-foreground sm:block">
          {t("unified_model_id_format")}
        </p>
      </div>

      {!hydrated || hydrating ? (
        <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <p className="text-copy-14 text-muted-foreground">
            {t("loading", { ns: "common" })}
          </p>
        </div>
      ) : models.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary">
            <Activity className="h-5 w-5 text-muted-foreground" />
          </span>
          <p className="text-copy-14 text-foreground">
            {t("unified_no_models_title")}
          </p>
          <p className="max-w-sm text-copy-13 text-muted-foreground">
            {t("unified_no_models_desc")}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("unified_search_placeholder")}
                className="pl-8"
              />
            </div>
            <Select value={providerFilter} onValueChange={setProviderFilter}>
              <SelectTrigger className="w-[150px]" aria-label="Provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("unified_all_providers")}</SelectItem>
                {providerOptions.map((provider) => (
                  <SelectItem key={provider} value={provider}>
                    {provider}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={featureFilter}
              onValueChange={(value) =>
                setFeatureFilter(value as "all" | ModelFeature)
              }
            >
              <SelectTrigger
                className="w-[130px]"
                aria-label={t("unified_feature_col")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("unified_all_features")}</SelectItem>
                {MODEL_FEATURES.map((feature) => (
                  <SelectItem key={feature.value} value={feature.value}>
                    {t(feature.label, { ns: "common" })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasFilter && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4" />
                {t("unified_clear_filters")}
              </Button>
            )}
            <span className="ml-auto font-mono text-copy-12 tabular-nums text-muted-foreground">
              {filtered.length} / {models.length}
            </span>
          </div>

          <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto] gap-3 border-b border-border bg-secondary/40 px-4 py-1.5 text-label-12 text-muted-foreground">
            <span>{t("unified_model_col")}</span>
            <span>{t("unified_real_model_col")}</span>
            <span>{t("unified_feature_col")}</span>
            <span className="text-right">{t("unified_enabled_col")}</span>
          </div>

          {filtered.length === 0 ? (
            <div className="px-5 py-8 text-center text-copy-14 text-muted-foreground">
              {t("unified_no_match")}
            </div>
          ) : (
            <ModelVirtualTable
              models={filtered}
              disabled={disabled}
              onToggle={onToggle}
            />
          )}
        </>
      )}
    </Card>
  );
}

export function UnifiedApiPage() {
  const { t } = useTranslation("pages");
  const supported = useUnifiedStore((s) => s.supported);
  const config = useUnifiedStore((s) => s.config);
  const status = useUnifiedStore((s) => s.status);
  const models = useUnifiedStore((s) => s.models);
  const modelsHydrated = useUnifiedStore((s) => s.modelsHydrated);
  const hydratingModels = useUnifiedStore((s) => s.hydratingModels);
  const busy = useUnifiedStore((s) => s.busy);
  const error = useUnifiedStore((s) => s.error);
  const init = useUnifiedStore((s) => s.init);
  const hydrateModels = useUnifiedStore((s) => s.hydrateModels);
  const setConfig = useUnifiedStore((s) => s.setConfig);
  const toggleModel = useUnifiedStore((s) => s.toggleModel);
  const start = useUnifiedStore((s) => s.start);
  const stop = useUnifiedStore((s) => s.stop);

  const [portInput, setPortInput] = useState(String(config.port));
  const [keyInput, setKeyInput] = useState(config.localKey);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    setPortInput(String(config.port));
    setKeyInput(config.localKey);
  }, [config.port, config.localKey]);

  const running = status?.running ?? false;
  const port = status?.port ?? config.port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const disabled = useMemo(
    () => new Set(config.disabledModelIds),
    [config.disabledModelIds]
  );
  const { enabledCount, firstEnabled } = useMemo(() => {
    let enabledCount = 0;
    let firstEnabled = "";
    for (const model of models) {
      if (disabled.has(model.id)) continue;
      enabledCount += 1;
      if (!firstEnabled) firstEnabled = model.id;
    }
    return { enabledCount, firstEnabled };
  }, [disabled, models]);

  const providerCount = useMemo(
    () => new Set(models.map((model) => model.provider)).size,
    [models]
  );

  const requestModels = useCallback(() => {
    void hydrateModels().catch(() => undefined);
  }, [hydrateModels]);

  const applyConfig = async () => {
    const p = Number(portInput);
    const port = Number.isFinite(p) && p > 0 && p < 65536 ? p : config.port;
    await setConfig({ port, localKey: keyInput.trim() });
  };

  return (
    <div>
      <PageHeader
        title={t("unified_title")}
        description={t("unified_desc")}
      />

      {!supported && (
        <div className="mb-5 flex items-start gap-2.5 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-copy-14">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            {t("unified_no_desktop")}
          </span>
        </div>
      )}

      {error && (
        <div className="mb-5 flex items-start gap-2.5 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-copy-14">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>{error}</span>
        </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t("unified_service_tab")}</TabsTrigger>
          <TabsTrigger value="integration">{t("unified_integration_tab")}</TabsTrigger>
          <TabsTrigger value="monitor">{t("unified_monitor_tab")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="space-y-4">
            {/* Hero status panel */}
            <div>
              <Card className="relative overflow-hidden">
                <span
                  aria-hidden
                  className={
                    "absolute inset-x-0 top-0 h-px " +
                    (running
                      ? "bg-gradient-to-r from-transparent via-success to-transparent"
                      : "bg-transparent")
                  }
                />
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-foreground/[0.03] blur-2xl"
                />
                <div className="relative flex flex-col gap-4 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <span className="relative flex h-3 w-3 items-center justify-center">
                      {running && (
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
                      )}
                      <span
                        className={
                          "relative inline-flex h-2.5 w-2.5 rounded-full " +
                          (running ? "bg-success" : "bg-muted-foreground/40")
                        }
                      />
                    </span>
                    <div>
                      <h3 className="text-heading-16 text-foreground">
                        {running ? t("unified_running") : t("unified_stopped")}
                      </h3>
                      <p className="text-copy-13 text-muted-foreground">
                        {running
                          ? config.localKey
                            ? t("unified_key_auth")
                            : t("unified_no_auth")
                          : t("unified_start_msg")}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 self-start sm:gap-5 sm:self-auto">
                    <div className="flex items-center divide-x divide-border/70">
                      <Metric value={port} label={t("unified_port_label")} />
                      <Metric value={enabledCount} label={t("unified_exposed_models_label")} />
                      <Metric value={providerCount} label={t("unified_providers_label")} />
                    </div>
                    {supported && (
                      <Button
                        variant={running ? "secondary" : "primary"}
                        disabled={busy}
                        onClick={() => (running ? stop() : start())}
                        className="min-w-[104px] sm:ml-1"
                      >
                        {busy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : running ? (
                          <Square className="h-4 w-4 fill-current" />
                        ) : (
                          <Play className="h-4 w-4 fill-current" />
                        )}
                        {busy
                          ? running
                            ? t("unified_stopping")
                            : t("unified_starting")
                          : running
                            ? t("unified_stop_service")
                            : t("unified_start_service")}
                      </Button>
                    )}
                  </div>
                </div>

	                <div className="relative grid gap-2.5 border-b border-border p-4 sm:grid-cols-2">
	                  <EndpointRow
	                    provider="openai"
	                    protocol={t("unified_openai_compat")}
	                    usage="Codex · SDK · agent"
	                    url={`${baseUrl}/v1`}
	                  />
	                  <EndpointRow
	                    provider="anthropic"
	                    protocol={t("unified_anthropic_compat")}
	                    usage="Claude Code"
	                    url={baseUrl}
                  />
                </div>

                {/* Inline configuration */}
                <div className="relative grid items-end gap-x-3 gap-y-3 p-4 sm:grid-cols-[112px_minmax(0,1fr)_auto]">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="port"
                      className="text-label-12 text-muted-foreground"
                    >
                      {t("unified_port_label")}
                    </Label>
                    <Input
                      id="port"
                      value={portInput}
                      onChange={(e) => setPortInput(e.target.value)}
                      placeholder="4141"
                      inputMode="numeric"
                      className="font-mono tabular-nums"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="localkey"
                      className="text-label-12 text-muted-foreground"
                    >
                      {t("unified_local_key_label")}
                    </Label>
                    <div className="relative">
                      <Input
                        id="localkey"
                        value={keyInput}
                        onChange={(e) => setKeyInput(e.target.value)}
                        placeholder={t("unified_local_key_placeholder")}
                        className="pr-[68px] font-mono"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setKeyInput(generateLocalKey())}
                        className="absolute right-1 top-1/2 h-7 -translate-y-1/2 px-2 text-muted-foreground"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        {t("unified_generate_key")}
                      </Button>
                    </div>
                  </div>
                  <Button onClick={applyConfig} className="w-full sm:w-auto">
                    <RefreshCw className="h-4 w-4" />
                    {t("unified_save_apply")}
                  </Button>
                </div>

                {/* Footer: autostart + hint */}
                <div className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-border bg-secondary/30 px-4 py-2.5">
                  <label className="flex cursor-pointer items-center gap-2 text-copy-13 text-muted-foreground">
	                    <Switch
	                      checked={config.autoStart}
	                      onCheckedChange={(v) => setConfig({ autoStart: v })}
	                    />
	                    {t("unified_autostart")}
	                  </label>
	                  {running && (
	                    <p className="text-copy-12 text-muted-foreground">
	                      {t("unified_restart_hint")}
	                    </p>
	                  )}
                </div>
              </Card>
            </div>

            {/* Exposed models */}
            <LazyOnVisible minHeight={520} onVisible={requestModels}>
              {() => (
                <div>
                  <ExposedModelsCard
                    models={models}
                    disabled={disabled}
                    hydrated={modelsHydrated}
                    hydrating={hydratingModels}
                    onToggle={toggleModel}
                  />
                </div>
              )}
            </LazyOnVisible>
          </div>
        </TabsContent>

        <TabsContent value="integration">
          <Suspense fallback={<UnifiedTabFallback />}>
            <IntegrationGuide
              baseUrl={baseUrl}
              localKey={config.localKey}
              sampleModel={firstEnabled}
            />
          </Suspense>
        </TabsContent>

        <TabsContent value="monitor">
          <Suspense fallback={<UnifiedTabFallback />}>
            <MonitorPanel />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
