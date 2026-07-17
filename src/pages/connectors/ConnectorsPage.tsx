import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Boxes,
  Check,
  ChevronRight,
  ExternalLink,
  KeyRound,
  Loader2,
  Play,
  Plug,
  RefreshCw,
  Search,
  ShieldCheck,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SchemaForm,
  buildArguments,
  ResultView,
} from "@/pages/mcp/inspector/shared";
import { useConnectorStore } from "@/store/connector";
import {
  consoleUrl,
  credentialFieldsFor,
  executeAction,
  getAction,
  getProvider,
  listConnections,
  listOAuthConfigs,
  listProviders,
  listRuns,
  openUrl,
  putConnection,
  putOAuthConfig,
  searchActions,
  startOAuthAuthorization,
  type ActionDefinition,
  type ActionExecuteResult,
  type AuthDefinition,
  type ConnectionRecord,
  type ConnectorStatus,
  type CredentialField,
  type OAuthConfigRecord,
  type ProviderDetail,
  type ProviderSummary,
  type RunLogRecord,
} from "@/lib/connector/api";

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Boxes;
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-md border border-border bg-background-secondary/60 p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-label-12 uppercase tracking-[0.06em]">{label}</span>
      </div>
      <p className="mt-1 text-heading-24 tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function CopyTokenButton({ token }: { token: string }) {
  const { t } = useTranslation("pages");
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(token);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* ignore */
        }
      }}
      title={t("connector_copy_token_hint")}
    >
      {copied ? (
        <Check className="h-4 w-4 text-success" />
      ) : (
        <KeyRound className="h-4 w-4" />
      )}
      <span>{copied ? t("connector_token_copied") : t("connector_copy_token")}</span>
    </Button>
  );
}

function providerHostname(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function providerInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

function ProviderIcon({ provider }: { provider: ProviderSummary }) {
  const host = providerHostname(provider.homepageUrl);
  const [failed, setFailed] = useState(false);
  const initials = providerInitials(provider.displayName || provider.service);
  const base =
    "flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background-secondary text-label-12 font-medium text-muted-foreground";
  if (!host || failed) {
    return <span className={base}>{initials}</span>;
  }
  return (
    <span className={base}>
      <img
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className="h-5 w-5 object-contain"
        src={`https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}`}
        onError={() => setFailed(true)}
      />
    </span>
  );
}

export function ConnectorsPage() {
  const { t } = useTranslation("pages");
  const supported = useConnectorStore((s) => s.supported);
  const config = useConnectorStore((s) => s.config);
  const status = useConnectorStore((s) => s.status);
  const busy = useConnectorStore((s) => s.busy);
  const error = useConnectorStore((s) => s.error);
  const init = useConnectorStore((s) => s.init);
  const setConfig = useConnectorStore((s) => s.setConfig);
  const start = useConnectorStore((s) => s.start);
  const stop = useConnectorStore((s) => s.stop);

  useEffect(() => {
    void init();
  }, [init]);

  const running = Boolean(status?.running);

  return (
    <div className="space-y-6">
      <section className="relative min-w-0 overflow-hidden rounded-lg border border-border bg-card p-5 shadow-geist-sm">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_12%,rgba(40,169,72,0.16),transparent_34%),linear-gradient(135deg,rgba(23,23,23,0.04),transparent_42%)]" />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl space-y-4">
            <Badge
              variant="accent"
              className="rounded-sm uppercase tracking-[0.08em]"
            >
              {t("connector_kicker")}
            </Badge>
            <div className="space-y-2">
              <h1 className="flex items-center gap-2 text-heading-32 text-foreground">
                <Plug className="h-7 w-7 text-primary" />
                {t("connector_title")}
              </h1>
              <p className="max-w-[62ch] text-copy-14 text-muted-foreground">
                {t("connector_desc")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {running ? (
                <Button
                  variant="secondary"
                  onClick={() => void stop()}
                  disabled={!supported || busy}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                  <span>{t("connector_stop_service")}</span>
                </Button>
              ) : (
                <Button
                  onClick={() => void start()}
                  disabled={!supported || busy}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  <span>{t("connector_start_service")}</span>
                </Button>
              )}
              {running && status && (
                <Button
                  variant="ghost"
                  onClick={() => void openUrl(consoleUrl(status))}
                >
                  <ExternalLink className="h-4 w-4" />
                  <span>{t("connector_open_console")}</span>
                </Button>
              )}
              {running && status && (
                <CopyTokenButton token={status.adminToken} />
              )}
            </div>
          </div>

          <div className="grid min-w-full grid-cols-2 gap-2 sm:min-w-[320px]">
            <Metric
              icon={Activity}
              label={t("connector_status_label")}
              value={
                running
                  ? status?.external
                    ? t("connector_running_external")
                    : t("connector_running")
                  : t("connector_stopped")
              }
            />
            <Metric
              icon={ShieldCheck}
              label={t("connector_port_label")}
              value={status?.port ?? config.port}
            />
          </div>
        </div>
      </section>

      {!supported && (
        <div className="rounded-md border border-border bg-background-secondary/50 p-4 text-copy-14 text-muted-foreground">
          {t("connector_no_desktop")}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-copy-14 text-destructive">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Label className="text-label-12 text-muted-foreground">
          {t("connector_port_label")}
        </Label>
        <Input
          type="number"
          className="w-28"
          value={config.port}
          disabled={running}
          onChange={(e) =>
            void setConfig({ port: Number(e.target.value) || config.port })
          }
        />
        <label className="flex items-center gap-2 text-copy-14">
          <input
            type="checkbox"
            checked={config.autoStart}
            onChange={(e) => void setConfig({ autoStart: e.target.checked })}
          />
          {t("connector_autostart")}
        </label>
      </div>

      {supported && running && status ? (
        <ConnectorWorkspace status={status} />
      ) : supported ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-copy-14 text-muted-foreground">
          {t("connector_start_hint")}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workspace (only rendered when the runtime is running)
// ---------------------------------------------------------------------------

function ConnectorWorkspace({ status }: { status: ConnectorStatus }) {
  const { t } = useTranslation("pages");
  return (
    <Tabs defaultValue="providers" className="space-y-4">
      <TabsList>
        <TabsTrigger value="providers">
          {t("connector_providers_tab")}
        </TabsTrigger>
        <TabsTrigger value="actions">{t("connector_actions_tab")}</TabsTrigger>
        <TabsTrigger value="runs">{t("connector_runs_tab")}</TabsTrigger>
      </TabsList>
      <TabsContent value="providers">
        <ProvidersTab status={status} />
      </TabsContent>
      <TabsContent value="actions">
        <ActionsTab status={status} />
      </TabsContent>
      <TabsContent value="runs">
        <RunsTab status={status} />
      </TabsContent>
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// Providers tab
// ---------------------------------------------------------------------------

type ProviderFilter = "all" | "connected" | "not_connected" | "oauth_needs_config";

const PROVIDER_PAGE_SIZE = 60;

function ProvidersTab({ status }: { status: ConnectorStatus }) {
  const { t } = useTranslation("pages");
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [oauthConfigs, setOAuthConfigs] = useState<OAuthConfigRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProviderFilter>("all");
  const [limit, setLimit] = useState(PROVIDER_PAGE_SIZE);
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [ps, cs, os] = await Promise.all([
        listProviders(status),
        listConnections(status).catch(() => [] as ConnectionRecord[]),
        listOAuthConfigs(status).catch(() => [] as OAuthConfigRecord[]),
      ]);
      setProviders(ps);
      setConnections(cs);
      setOAuthConfigs(os);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connectedServices = useMemo(
    () => new Set(connections.filter((c) => c.configured).map((c) => c.service)),
    [connections]
  );
  const oauthConfiguredServices = useMemo(
    () => new Set(oauthConfigs.filter((c) => c.configured).map((c) => c.service)),
    [oauthConfigs]
  );

  const isConnected = useCallback(
    (p: ProviderSummary) => connectedServices.has(p.service),
    [connectedServices]
  );
  const needsOAuthConfig = useCallback(
    (p: ProviderSummary) =>
      p.authTypes.includes("oauth2") && !oauthConfiguredServices.has(p.service),
    [oauthConfiguredServices]
  );

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return providers;
    return providers.filter(
      (p) =>
        p.service.toLowerCase().includes(q) ||
        p.displayName.toLowerCase().includes(q) ||
        p.categories.some((c) => c.toLowerCase().includes(q))
    );
  }, [providers, query]);

  const counts = useMemo(
    () => ({
      all: searched.length,
      connected: searched.filter(isConnected).length,
      not_connected: searched.filter((p) => !isConnected(p)).length,
      oauth_needs_config: searched.filter(needsOAuthConfig).length,
    }),
    [searched, isConnected, needsOAuthConfig]
  );

  const visible = useMemo(() => {
    switch (filter) {
      case "connected":
        return searched.filter(isConnected);
      case "not_connected":
        return searched.filter((p) => !isConnected(p));
      case "oauth_needs_config":
        return searched.filter(needsOAuthConfig);
      default:
        return searched;
    }
  }, [searched, filter, isConnected, needsOAuthConfig]);

  useEffect(() => {
    setLimit(PROVIDER_PAGE_SIZE);
  }, [query, filter]);

  const rendered = visible.slice(0, limit);
  const hasMore = visible.length > limit;

  const filterOptions = useMemo(
    () => [
      { value: "all" as const, labelKey: "connector_filter_all", count: counts.all },
      {
        value: "connected" as const,
        labelKey: "connector_connected",
        count: counts.connected,
      },
      {
        value: "not_connected" as const,
        labelKey: "connector_filter_not_connected",
        count: counts.not_connected,
      },
      {
        value: "oauth_needs_config" as const,
        labelKey: "connector_filter_oauth_needs_config",
        count: counts.oauth_needs_config,
      },
    ],
    [counts]
  );

  const actionLabel = useCallback(
    (p: ProviderSummary) =>
      isConnected(p)
        ? t("connector_manage")
        : needsOAuthConfig(p)
          ? t("connector_configure_oauth")
          : t("connector_connect_action"),
    [isConnected, needsOAuthConfig, t]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={t("connector_search_providers")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button variant="ghost" onClick={() => void refresh()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl<ProviderFilter>
          size="sm"
          value={filter}
          onChange={setFilter}
          options={filterOptions.map((o) => ({
            value: o.value,
            label: (
              <span className="inline-flex items-center gap-1.5">
                {t(o.labelKey)}
                <span className="tabular-nums text-muted-foreground">
                  {o.count}
                </span>
              </span>
            ),
          }))}
        />
        <span className="text-label-12 text-muted-foreground tabular-nums">
          {t("connector_result_count", {
            shown: visible.length,
            total: providers.length,
          })}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 p-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("connector_loading")}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-md border border-border bg-background-secondary/40 p-8 text-center text-copy-14 text-muted-foreground">
          {t("connector_no_providers")}
        </div>
      ) : (
        <>
          <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {rendered.map((p) => (
              <button
                key={p.service}
                type="button"
                onClick={() => setSelected(p.service)}
                className="group flex w-full items-center gap-3 rounded-md border border-border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-background-secondary/40"
              >
                <ProviderIcon provider={p} />
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate text-copy-14 font-medium text-foreground">
                    {p.displayName || p.service}
                  </span>
                  {isConnected(p) && (
                    <Badge variant="accent" className="shrink-0">
                      {t("connector_connected")}
                    </Badge>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-0.5 text-label-12 text-muted-foreground transition-colors group-hover:text-foreground">
                  <span className="hidden sm:inline">{actionLabel(p)}</span>
                  <ChevronRight className="h-4 w-4" />
                </span>
              </button>
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setLimit((n) => Math.min(n + PROVIDER_PAGE_SIZE, visible.length))
                }
              >
                {t("connector_show_more")}
              </Button>
            </div>
          )}
        </>
      )}

      {selected && (
        <ProviderDialog
          status={status}
          service={selected}
          onClose={() => setSelected(null)}
          onChanged={() => void refresh()}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Provider detail dialog: credential config + OAuth client + actions overview
// ---------------------------------------------------------------------------

function CredentialInput({
  field,
  value,
  onChange,
}: {
  field: CredentialField;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-label-12 font-medium text-foreground">
        {field.label}
        {field.required && <span className="text-destructive"> *</span>}
      </label>
      {field.inputType === "textarea" || field.inputType === "json" ? (
        <Textarea
          placeholder={field.placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-copy-13"
        />
      ) : (
        <Input
          type={field.inputType === "password" ? "password" : "text"}
          placeholder={field.placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.description && (
        <p className="text-label-12 text-muted-foreground">{field.description}</p>
      )}
    </div>
  );
}

function ProviderDialog({
  status,
  service,
  onClose,
  onChanged,
}: {
  status: ConnectorStatus;
  service: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation("pages");
  const [detail, setDetail] = useState<ProviderDetail | null>(null);
  const [oauth, setOAuth] = useState<OAuthConfigRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [values, setValues] = useState<Record<string, string>>({});
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getProvider(status, service);
      setDetail(d);
      const configs = await listOAuthConfigs(status).catch(
        () => [] as OAuthConfigRecord[]
      );
      const found = configs.find((c) => c.service === service) ?? null;
      setOAuth(found);
      if (found?.clientId) setClientId(found.clientId);
    } finally {
      setLoading(false);
    }
  }, [status, service]);

  useEffect(() => {
    void load();
  }, [load]);

  const setField = (key: string, value: string) =>
    setValues((cur) => ({ ...cur, [key]: value }));

  const saveCredential = async (auth: AuthDefinition) => {
    const fields = credentialFieldsFor(auth);
    const missing = fields.find((f) => f.required && !(values[f.key] ?? "").trim());
    if (missing) {
      setMsg(t("connector_field_required", { field: missing.label }));
      return;
    }
    const payload: Record<string, string> = {};
    for (const f of fields) {
      const v = values[f.key];
      if (v != null && v !== "") payload[f.key] = v;
    }
    setSaving(true);
    setMsg(null);
    try {
      await putConnection(status, service, auth.type, payload);
      setMsg(t("connector_saved"));
      for (const f of fields) if (f.secret) setField(f.key, "");
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const connectNoAuth = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await putConnection(status, service, "no_auth", {});
      setMsg(t("connector_saved"));
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const saveOAuthClient = async () => {
    if (!clientId.trim() || !clientSecret.trim()) return;
    setSaving(true);
    setMsg(null);
    try {
      await putOAuthConfig(status, service, clientId.trim(), clientSecret.trim());
      setClientSecret("");
      setMsg(t("connector_saved"));
      await load();
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const authorize = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const { authorizationUrl } = await startOAuthAuthorization(status, service);
      if (authorizationUrl) {
        await openUrl(authorizationUrl);
        setMsg(t("connector_authorize_opened"));
      } else {
        setMsg(t("connector_authorize_failed"));
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <ProviderIcon
              provider={detail ?? ({ service, displayName: service } as ProviderSummary)}
            />
            <div className="min-w-0">
              <DialogTitle>{detail?.displayName ?? service}</DialogTitle>
              <DialogDescription>{service}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("connector_loading")}
          </div>
        ) : (
          <div className="space-y-5">
            {(detail?.auth ?? []).map((auth, idx) => {
              const border = idx > 0 ? "border-t border-border pt-4" : "";
              if (auth.type === "no_auth") {
                return (
                  <section key={`auth-${idx}`} className={`space-y-2 ${border}`}>
                    <div className="flex items-center gap-2 text-copy-14 font-medium">
                      <ShieldCheck className="h-4 w-4" />
                      {t("connector_auth_no_auth")}
                    </div>
                    <p className="text-label-12 text-muted-foreground">
                      {t("connector_no_auth_desc")}
                    </p>
                    <Button
                      size="sm"
                      disabled={saving}
                      onClick={() => void connectNoAuth()}
                    >
                      {t("connector_connect")}
                    </Button>
                  </section>
                );
              }
              if (auth.type === "oauth2") {
                return (
                  <section key={`auth-${idx}`} className={`space-y-2 ${border}`}>
                    <div className="flex items-center gap-2 text-copy-14 font-medium">
                      <ShieldCheck className="h-4 w-4" />
                      {t("connector_oauth_client")}
                    </div>
                    {oauth && (
                      <p className="text-label-12 text-muted-foreground">
                        {t("connector_redirect_uri")}:{" "}
                        <code className="break-all">{oauth.expectedRedirectUri}</code>
                      </p>
                    )}
                    <Input
                      placeholder="Client ID"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                    />
                    <Input
                      type="password"
                      placeholder="Client Secret"
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={saving || !clientId.trim() || !clientSecret.trim()}
                        onClick={() => void saveOAuthClient()}
                      >
                        {t("connector_save_oauth_client")}
                      </Button>
                      <Button
                        size="sm"
                        disabled={saving || !oauth?.configured}
                        onClick={() => void authorize()}
                      >
                        <ExternalLink className="h-4 w-4" />
                        {t("connector_authorize")}
                      </Button>
                    </div>
                  </section>
                );
              }
              const fields = credentialFieldsFor(auth);
              const title =
                auth.type === "custom_credential"
                  ? t("connector_auth_custom")
                  : t("connector_api_key");
              return (
                <section key={`auth-${idx}`} className={`space-y-2 ${border}`}>
                  <div className="flex items-center gap-2 text-copy-14 font-medium">
                    <KeyRound className="h-4 w-4" />
                    {title}
                  </div>
                  {fields.map((f) => (
                    <CredentialInput
                      key={f.key}
                      field={f}
                      value={values[f.key] ?? ""}
                      onChange={(v) => setField(f.key, v)}
                    />
                  ))}
                  <Button
                    size="sm"
                    disabled={saving}
                    onClick={() => void saveCredential(auth)}
                  >
                    {t("connector_save_credentials")}
                  </Button>
                </section>
              );
            })}

            <section className="space-y-1 border-t border-border pt-4">
              <div className="text-copy-14 font-medium">
                {t("connector_actions_tab")} ({detail?.actions.length ?? 0})
              </div>
              <ul className="max-h-40 space-y-1 overflow-y-auto text-label-12 text-muted-foreground">
                {detail?.actions.slice(0, 60).map((a) => (
                  <li key={a.id} className="truncate">
                    <code>{a.id}</code>
                  </li>
                ))}
              </ul>
            </section>

            {msg && <p className="text-label-12 text-muted-foreground">{msg}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("connector_close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Actions tab: search + debug an action
// ---------------------------------------------------------------------------

function ActionsTab({ status }: { status: ConnectorStatus }) {
  const { t } = useTranslation("pages");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    { id: string; name: string; description?: string }[]
  >([]);
  const [searching, setSearching] = useState(false);
  const [action, setAction] = useState<ActionDefinition | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [alias, setAlias] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ActionExecuteResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const doSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const r = await searchActions(status, query.trim(), 25);
      setResults(r);
    } finally {
      setSearching(false);
    }
  }, [status, query]);

  const pick = async (id: string) => {
    setResult(null);
    setFormError(null);
    setValues({});
    const def = await getAction(status, id);
    setAction(def);
  };

  const run = async () => {
    if (!action) return;
    setFormError(null);
    let input: Record<string, unknown>;
    try {
      input = buildArguments(action.inputSchema, values);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const res = await executeAction(
        status,
        action.id,
        input,
        alias.trim() || undefined
      );
      setResult(res);
    } catch (e) {
      setResult({
        ok: false,
        message: e instanceof Error ? e.message : String(e),
        raw: null,
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void doSearch();
          }}
        >
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder={t("connector_search_actions")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={searching}>
            {searching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
        </form>
        <div className="space-y-1">
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => void pick(r.id)}
              className={`block w-full rounded-md border p-2 text-left transition-colors hover:border-primary/50 ${
                action?.id === r.id ? "border-primary" : "border-border"
              }`}
            >
              <div className="text-copy-14 font-medium text-foreground">
                {r.name}
              </div>
              <code className="text-label-12 text-muted-foreground">{r.id}</code>
              {r.description && (
                <p className="mt-0.5 line-clamp-2 text-label-12 text-muted-foreground">
                  {r.description}
                </p>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {action ? (
          <div className="space-y-3 rounded-md border border-border bg-card p-4">
            <div>
              <div className="text-copy-14 font-medium text-foreground">
                {action.name}
              </div>
              <code className="text-label-12 text-muted-foreground">
                {action.id}
              </code>
            </div>
            <div className="space-y-1">
              <Label className="text-label-12 text-muted-foreground">
                {t("connector_alias_label")}
              </Label>
              <Input
                placeholder={t("connector_alias_placeholder")}
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
              />
            </div>
            <SchemaForm
              schema={action.inputSchema}
              values={values}
              onChange={setValues}
            />
            {formError && (
              <p className="text-label-12 text-destructive">{formError}</p>
            )}
            <Button disabled={running} onClick={() => void run()}>
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {t("connector_run_action")}
            </Button>
            {result && (
              <div className="space-y-2 border-t border-border pt-3">
                <div className="flex items-center gap-2">
                  <Badge variant={result.ok ? "accent" : "destructive"}>
                    {result.ok
                      ? t("connector_run_ok")
                      : result.errorCode || t("connector_run_failed")}
                  </Badge>
                  {result.message && (
                    <span className="text-label-12 text-muted-foreground">
                      {result.message}
                    </span>
                  )}
                </div>
                <ResultView result={result.data ?? result.raw} />
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border p-8 text-center text-copy-14 text-muted-foreground">
            {t("connector_pick_action")}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Runs tab
// ---------------------------------------------------------------------------

function RunsTab({ status }: { status: ConnectorStatus }) {
  const { t } = useTranslation("pages");
  const [runs, setRuns] = useState<RunLogRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRuns(await listRuns(status, 50));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="ghost" onClick={() => void refresh()}>
          <RefreshCw className="h-4 w-4" />
          {t("connector_refresh")}
        </Button>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 p-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("connector_loading")}
        </div>
      ) : runs.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-copy-14 text-muted-foreground">
          {t("connector_no_runs")}
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-label-12">
            <thead className="bg-background-secondary/60 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">
                  {t("connector_run_action_col")}
                </th>
                <th className="px-3 py-2 text-left">
                  {t("connector_run_status_col")}
                </th>
                <th className="px-3 py-2 text-left">
                  {t("connector_run_duration_col")}
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r, i) => {
                const okish =
                  r.ok === true ||
                  r.status === "completed" ||
                  r.status === "success";
                return (
                  <tr
                    key={r.id ?? r.executionId ?? i}
                    className="border-t border-border"
                  >
                    <td className="px-3 py-2">
                      <code>{r.actionId ?? "—"}</code>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={okish ? "accent" : "destructive"}>
                        {r.status ?? (okish ? "ok" : "error")}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {r.durationMs != null ? `${r.durationMs}ms` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default ConnectorsPage;
