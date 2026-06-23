import { useEffect, useMemo, useState } from "react";
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
import { Reveal } from "@/components/common/Reveal";
import {
  ModelIcon,
  ProviderIcon,
} from "@/components/common/ProviderModelIcon";
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
  featureLabel,
  generateLocalKey,
  MODEL_FEATURES,
  type ModelFeature,
} from "@/lib/unifiedApi";
import { IntegrationGuide } from "./IntegrationGuide";
import { MonitorPanel } from "./MonitorPanel";

function CopyButton({ text, label }: { text: string; label?: string }) {
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
      aria-label={label ?? "复制"}
      title={label ?? "复制"}
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
  return (
    <div className="group flex items-center gap-2.5 rounded-md border border-border bg-background/70 px-2.5 py-2 transition-colors duration-150 hover:border-muted-foreground/30">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-secondary">
        <ProviderIcon provider={provider} className="h-4 w-4" />
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
      <CopyButton text={url} label={`复制 ${protocol} 地址`} />
    </div>
  );
}

export function UnifiedApiPage() {
  const {
    supported,
    config,
    status,
    models,
    busy,
    error,
    init,
    setConfig,
    toggleModel,
    start,
    stop,
  } = useUnifiedStore();

  const [portInput, setPortInput] = useState(String(config.port));
  const [keyInput, setKeyInput] = useState(config.localKey);
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [featureFilter, setFeatureFilter] = useState<"all" | ModelFeature>(
    "all"
  );

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
  const enabledCount = models.filter((m) => !disabled.has(m.id)).length;
  const firstEnabled = models.find((m) => !disabled.has(m.id))?.id ?? "";

  const providerOptions = useMemo(
    () => [...new Set(models.map((m) => m.provider))].sort(),
    [models]
  );
  const providerCount = providerOptions.length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter((m) => {
      if (providerFilter !== "all" && m.provider !== providerFilter)
        return false;
      if (featureFilter !== "all" && !m.features.includes(featureFilter))
        return false;
      if (
        q &&
        !m.id.toLowerCase().includes(q) &&
        !m.realModel.toLowerCase().includes(q) &&
        !m.connName.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [models, query, providerFilter, featureFilter]);

  const hasFilter =
    query.trim() !== "" || providerFilter !== "all" || featureFilter !== "all";

  const clearFilters = () => {
    setQuery("");
    setProviderFilter("all");
    setFeatureFilter("all");
  };

  const grouped = useMemo(() => {
    const map = new Map<string, typeof models>();
    for (const m of filtered) {
      const arr = map.get(m.connName) ?? [];
      arr.push(m);
      map.set(m.connName, arr);
    }
    return [...map.entries()];
  }, [filtered]);

  const applyConfig = async () => {
    const p = Number(portInput);
    const port = Number.isFinite(p) && p > 0 && p < 65536 ? p : config.port;
    await setConfig({ port, localKey: keyInput.trim() });
  };

  return (
    <div>
      <PageHeader
        title="本地 Unified API"
        description="把已接入的模型统一暴露为本地 OpenAI / Anthropic 兼容服务，供 Codex、Claude Code 与本地 agent 使用。"
      />

      {!supported && (
        <div className="mb-5 flex items-start gap-2.5 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-copy-14">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            本地服务需要桌面端（Tauri）运行环境。浏览器开发模式下可预览配置与接入文档，但无法启动 HTTP 服务。
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
          <TabsTrigger value="overview">服务</TabsTrigger>
          <TabsTrigger value="integration">接入方式</TabsTrigger>
          <TabsTrigger value="monitor">监控</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="space-y-4">
            {/* Hero status panel */}
            <Reveal index={0}>
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
                        {running ? "运行中" : "已停止"}
                      </h3>
                      <p className="text-copy-13 text-muted-foreground">
                        {running
                          ? config.localKey
                            ? "已开启本地 Key 访问校验"
                            : "未设置访问校验 · 仅本机可达"
                          : "启动服务以开始监听本地请求"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 self-start sm:gap-5 sm:self-auto">
                    <div className="flex items-center divide-x divide-border/70">
                      <Metric value={port} label="端口" />
                      <Metric value={enabledCount} label="已暴露模型" />
                      <Metric value={providerCount} label="Provider" />
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
                            ? "停止中"
                            : "启动中"
                          : running
                            ? "停止服务"
                            : "启动服务"}
                      </Button>
                    )}
                  </div>
                </div>

                <div className="relative grid gap-2.5 border-b border-border p-4 sm:grid-cols-2">
                  <EndpointRow
                    provider="openai"
                    protocol="OpenAI 兼容"
                    usage="Codex · SDK · agent"
                    url={`${baseUrl}/v1`}
                  />
                  <EndpointRow
                    provider="anthropic"
                    protocol="Anthropic 兼容"
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
                      端口
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
                      本地 API Key（可选）
                    </Label>
                    <div className="relative">
                      <Input
                        id="localkey"
                        value={keyInput}
                        onChange={(e) => setKeyInput(e.target.value)}
                        placeholder="留空表示不校验"
                        className="pr-[68px] font-mono"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setKeyInput(generateLocalKey())}
                        className="absolute right-1 top-1/2 h-7 -translate-y-1/2 px-2 text-muted-foreground"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        生成
                      </Button>
                    </div>
                  </div>
                  <Button onClick={applyConfig} className="w-full sm:w-auto">
                    <RefreshCw className="h-4 w-4" />
                    保存并应用
                  </Button>
                </div>

                {/* Footer: autostart + hint */}
                <div className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-border bg-secondary/30 px-4 py-2.5">
                  <label className="flex cursor-pointer items-center gap-2 text-copy-13 text-muted-foreground">
                    <Switch
                      checked={config.autoStart}
                      onCheckedChange={(v) => setConfig({ autoStart: v })}
                    />
                    启动应用时自动开启服务
                  </label>
                  {running && (
                    <p className="text-copy-12 text-muted-foreground">
                      修改端口后需停止并重新启动服务才会生效
                    </p>
                  )}
                </div>
              </Card>
            </Reveal>

            {/* Exposed models */}
            <Reveal index={1}>
              <Card className="overflow-hidden">
                <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-heading-16">暴露的模型</h3>
                  </div>
                  <p className="hidden text-copy-13 text-muted-foreground sm:block">
                    id 形如{" "}
                    <code className="font-mono">{"{provider}/{model}"}</code>
                  </p>
                </div>

                {models.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary">
                      <Activity className="h-5 w-5 text-muted-foreground" />
                    </span>
                    <p className="text-copy-14 text-foreground">
                      还没有可暴露的模型
                    </p>
                    <p className="max-w-sm text-copy-13 text-muted-foreground">
                      请先在「模型接入」中接入 Provider 并拉取模型，这里会自动列出。
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
                      <div className="relative min-w-[200px] flex-1">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="搜索模型名 / 实际模型 / 连接…"
                          className="pl-8"
                        />
                      </div>
                      <Select
                        value={providerFilter}
                        onValueChange={setProviderFilter}
                      >
                        <SelectTrigger className="w-[150px]">
                          <SelectValue placeholder="Provider" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">全部 Provider</SelectItem>
                          {providerOptions.map((p) => (
                            <SelectItem key={p} value={p}>
                              <span className="flex items-center gap-2">
                                <ProviderIcon
                                  provider={p}
                                  className="h-3.5 w-3.5"
                                />
                                {p}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={featureFilter}
                        onValueChange={(v) =>
                          setFeatureFilter(v as "all" | ModelFeature)
                        }
                      >
                        <SelectTrigger className="w-[130px]">
                          <SelectValue placeholder="能力" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">全部能力</SelectItem>
                          {MODEL_FEATURES.map((f) => (
                            <SelectItem key={f.value} value={f.value}>
                              {f.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {hasFilter && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={clearFilters}
                        >
                          <X className="h-4 w-4" />
                          清除
                        </Button>
                      )}
                      <span className="ml-auto font-mono text-copy-12 tabular-nums text-muted-foreground">
                        {filtered.length} / {models.length}
                      </span>
                    </div>

                    <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto] gap-3 border-b border-border bg-secondary/40 px-4 py-1.5 text-label-12 text-muted-foreground">
                      <span>模型</span>
                      <span>实际模型</span>
                      <span>能力</span>
                      <span className="text-right">启用</span>
                    </div>

                    {filtered.length === 0 ? (
                      <div className="px-5 py-8 text-center text-copy-14 text-muted-foreground">
                        没有匹配的模型，试试调整筛选条件。
                      </div>
                    ) : (
                      <div className="max-h-[400px] overflow-y-auto">
                        {grouped.map(([connName, list]) => (
                          <div key={connName}>
                            <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-card/95 px-4 py-1 text-label-12 text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-card/80">
                              <span className="truncate">{connName}</span>
                              <span className="font-mono tabular-nums text-muted-foreground/60">
                                {list.length}
                              </span>
                            </div>
                            {list.map((m) => {
                              const on = !disabled.has(m.id);
                              const sameAsId =
                                m.realModel === m.id.split("/").pop();
                              return (
                                <div
                                  key={m.id}
                                  className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto] items-center gap-3 px-4 py-1.5 transition-colors duration-150 hover:bg-secondary/40"
                                >
                                  <div className="flex min-w-0 items-center gap-2">
                                    <ModelIcon
                                      model={m.realModel}
                                      className="h-4 w-4 shrink-0"
                                    />
                                    <code
                                      className="truncate font-mono text-copy-13 text-foreground"
                                      title={m.id}
                                    >
                                      {m.id}
                                    </code>
                                    <CopyButton text={m.id} label="复制模型 id" />
                                  </div>
                                  <div className="min-w-0">
                                    {sameAsId ? (
                                      <span className="text-label-12 text-muted-foreground/50">
                                        —
                                      </span>
                                    ) : (
                                      <code
                                        className="block truncate font-mono text-label-12 text-muted-foreground"
                                        title={m.realModel}
                                      >
                                        {m.realModel}
                                      </code>
                                    )}
                                  </div>
                                  <div className="flex min-w-0 flex-wrap gap-1">
                                    {m.features.length > 0 ? (
                                      m.features.map((f) => (
                                        <Badge
                                          key={f}
                                          variant="accent"
                                          className="px-1.5 py-0 text-[10px]"
                                        >
                                          {featureLabel(f)}
                                        </Badge>
                                      ))
                                    ) : (
                                      <span className="text-label-12 text-muted-foreground/50">
                                        —
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex justify-end">
                                    <Switch
                                      checked={on}
                                      onCheckedChange={(v) =>
                                        toggleModel(m.id, v)
                                      }
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </Card>
            </Reveal>
          </div>
        </TabsContent>

        <TabsContent value="integration">
          <IntegrationGuide
            baseUrl={baseUrl}
            localKey={config.localKey}
            sampleModel={firstEnabled}
          />
        </TabsContent>

        <TabsContent value="monitor">
          <MonitorPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
