import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Boxes,
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
import { Reveal } from "@/components/common/Reveal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  type ConnectionRecord,
  type ConnectorStatus,
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

function ProvidersTab({ status }: { status: ConnectorStatus }) {
  const { t } = useTranslation("pages");
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [ps, cs] = await Promise.all([
        listProviders(status),
        listConnections(status).catch(() => [] as ConnectionRecord[]),
      ]);
      setProviders(ps);
      setConnections(cs);
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return providers.slice(0, 120);
    return providers
      .filter(
        (p) =>
          p.service.toLowerCase().includes(q) ||
          p.displayName.toLowerCase().includes(q) ||
          p.categories.some((c) => c.toLowerCase().includes(q))
      )
      .slice(0, 120);
  }, [providers, query]);

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

      {loading ? (
        <div className="flex items-center gap-2 p-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("connector_loading")}
        </div>
      ) : (
        <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p, i) => (
            <Reveal key={p.service} index={i}>
              <button
                type="button"
                onClick={() => setSelected(p.service)}
                className="flex w-full flex-col gap-2 rounded-md border border-border bg-card p-3 text-left transition-colors hover:border-primary/50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-copy-14 font-medium text-foreground">
                    {p.displayName}
                  </span>
                  {connectedServices.has(p.service) && (
                    <Badge variant="accent" className="shrink-0">
                      {t("connector_connected")}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {p.authTypes.map((a) => (
                    <Badge key={a} variant="outline" className="text-label-12">
                      {a}
                    </Badge>
                  ))}
                </div>
              </button>
            </Reveal>
          ))}
        </div>
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

  const [apiKey, setApiKey] = useState("");
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

  const authTypes = detail?.authTypes ?? [];
  const supportsApiKey =
    authTypes.includes("api_key") || authTypes.includes("custom");
  const supportsOAuth = authTypes.includes("oauth2");

  const saveApiKey = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setMsg(null);
    try {
      await putConnection(status, service, "api_key", { apiKey: apiKey.trim() });
      setMsg(t("connector_saved"));
      setApiKey("");
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
          <DialogTitle>{detail?.displayName ?? service}</DialogTitle>
          <DialogDescription>{service}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("connector_loading")}
          </div>
        ) : (
          <div className="space-y-5">
            {supportsApiKey && (
              <section className="space-y-2">
                <div className="flex items-center gap-2 text-copy-14 font-medium">
                  <KeyRound className="h-4 w-4" />
                  {t("connector_api_key")}
                </div>
                <Input
                  type="password"
                  placeholder={t("connector_api_key_placeholder")}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <Button
                  size="sm"
                  disabled={saving || !apiKey.trim()}
                  onClick={() => void saveApiKey()}
                >
                  {t("connector_save_credentials")}
                </Button>
              </section>
            )}

            {supportsOAuth && (
              <section className="space-y-2 border-t border-border pt-4">
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
            )}

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
