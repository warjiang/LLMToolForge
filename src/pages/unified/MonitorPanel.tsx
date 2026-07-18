import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Download, Eraser, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUnifiedStore } from "@/store/unified";
import { getCallBody, type CallBody, type CallLogRecord } from "@/lib/unifiedApi";

function isOk(r: CallLogRecord): boolean {
  return !r.error && r.status >= 200 && r.status < 400;
}

/** Sentinel used by the source filter to mean "all sources". */
const ALL_SOURCES = "__all__";

/**
 * Classify a call's originating source from its User-Agent. External agents are
 * tagged `LLMToolForge-Agent/<packageId> (...)` by the host; the built-in agent
 * runs in the WebView, so its requests carry a browser UA. Everything else is
 * grouped as an external / unknown client.
 */
function sourceLabel(r: CallLogRecord, builtinLabel: string, unknownLabel: string): string {
  const ua = (r.userAgent ?? "").trim();
  if (!ua) return unknownLabel;
  const m = ua.match(/^LLMToolForge-Agent\/([^\s(]+)/i);
  if (m) return m[1];
  if (/mozilla|webkit|chrome|safari|tauri/i.test(ua)) return builtinLabel;
  // Fall back to the UA's leading token (e.g. `openai-python/1.2`).
  return ua.split(/[\s/]/)[0] || unknownLabel;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-label-12 text-muted-foreground">{label}</div>
      <div className="mt-1 text-heading-24 tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-copy-12 text-muted-foreground">{sub}</div>}
    </Card>
  );
}

/** Horizontal bar chart from {label, value} rows. */
function BarChart({
  data,
  empty,
}: {
  data: { label: string; value: number; hint?: string }[];
  empty: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (data.length === 0) {
    return <div className="py-6 text-center text-copy-13 text-muted-foreground">{empty}</div>;
  }
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-2">
          <div className="w-40 shrink-0 truncate text-copy-12 text-muted-foreground" title={d.label}>
            {d.label}
          </div>
          <div className="relative h-5 flex-1 overflow-hidden rounded bg-secondary/50">
            <div
              className="h-full rounded bg-accent"
              style={{ width: `${(d.value / max) * 100}%` }}
            />
          </div>
          <div className="w-16 shrink-0 text-right text-copy-12 tabular-nums">
            {d.hint ?? d.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Requests over time as a sparkline of per-minute buckets. */
function Timeline({ logs }: { logs: CallLogRecord[] }) {
  const buckets = useMemo(() => {
    const N = 30;
    const now = Date.now();
    const slot = 60_000;
    const arr = new Array(N).fill(0);
    for (const r of logs) {
      const age = now - r.ts;
      const idx = N - 1 - Math.floor(age / slot);
      if (idx >= 0 && idx < N) arr[idx] += 1;
    }
    return arr;
  }, [logs]);

  const max = Math.max(1, ...buckets);
  const w = 100;
  const h = 36;
  const step = w / buckets.length;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full" preserveAspectRatio="none">
      {buckets.map((v, i) => {
        const bh = (v / max) * (h - 2);
        return (
          <rect
            key={i}
            x={i * step + 0.5}
            y={h - bh}
            width={step - 1}
            height={bh}
            className="fill-accent"
            rx={0.5}
          />
        );
      })}
    </svg>
  );
}

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(logs: CallLogRecord[]): string {
  const head = [
    "ts",
    "source",
    "exposedModel",
    "provider",
    "protocol",
    "stream",
    "status",
    "durationMs",
    "promptTokens",
    "completionTokens",
    "totalTokens",
    "userAgent",
    "error",
  ];
  const rows = logs.map((r) =>
    [
      new Date(r.ts).toISOString(),
      sourceLabel(r, "built-in", "unknown"),
      r.exposedModel,
      r.provider,
      r.protocol,
      r.stream,
      r.status,
      r.durationMs,
      r.promptTokens ?? "",
      r.completionTokens ?? "",
      r.totalTokens ?? "",
      (r.userAgent ?? "").replace(/"/g, '""'),
      (r.error ?? "").replace(/"/g, '""'),
    ]
      .map((v) => `"${String(v)}"`)
      .join(",")
  );
  return [head.join(","), ...rows].join("\n");
}

export function MonitorPanel() {
  const { t } = useTranslation("pages");
  const logs = useUnifiedStore((s) => s.logs);
  const loadLogs = useUnifiedStore((s) => s.loadLogs);
  const clearLogs = useUnifiedStore((s) => s.clearLogs);
  const clearBodies = useUnifiedStore((s) => s.clearBodies);

  const [sourceFilter, setSourceFilter] = useState<string>(ALL_SOURCES);
  const [selected, setSelected] = useState<CallLogRecord | null>(null);

  const builtinLabel = t("monitor_source_builtin");
  const unknownLabel = t("monitor_source_unknown");

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  // Requests grouped by originating source (across all logs, unfiltered).
  const bySource = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of logs) {
      const label = sourceLabel(r, builtinLabel, unknownLabel);
      map.set(label, (map.get(label) ?? 0) + 1);
    }
    return [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [logs, builtinLabel, unknownLabel]);

  // Rows matching the active source filter feed the stats, charts, and table.
  const filtered = useMemo(() => {
    if (sourceFilter === ALL_SOURCES) return logs;
    return logs.filter(
      (r) => sourceLabel(r, builtinLabel, unknownLabel) === sourceFilter
    );
  }, [logs, sourceFilter, builtinLabel, unknownLabel]);

  const metrics = useMemo(() => {
    const total = filtered.length;
    const ok = filtered.filter(isOk).length;
    const durations = filtered.map((r) => r.durationMs).sort((a, b) => a - b);
    const avg = total ? Math.round(durations.reduce((a, b) => a + b, 0) / total) : 0;
    const p95 = durations.length
      ? durations[Math.min(durations.length - 1, Math.round(0.95 * (durations.length - 1)))]
      : 0;
    const tokens = filtered.reduce((a, r) => a + (r.totalTokens ?? 0), 0);
    return {
      total,
      ok,
      successRate: total ? Math.round((ok / total) * 100) : 0,
      avg,
      p95,
      tokens,
    };
  }, [filtered]);

  const byModel = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) map.set(r.exposedModel, (map.get(r.exposedModel) ?? 0) + 1);
    return [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [filtered]);

  const tokenByModel = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered)
      map.set(r.exposedModel, (map.get(r.exposedModel) ?? 0) + (r.totalTokens ?? 0));
    return [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [filtered]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label={t("monitor_total_requests")} value={String(metrics.total)} />
        <Stat label={t("monitor_success_rate")} value={`${metrics.successRate}%`} sub={`${metrics.ok}/${metrics.total}`} />
        <Stat label={t("monitor_avg_time")} value={`${metrics.avg}ms`} />
        <Stat label={t("monitor_p95_time")} value={`${metrics.p95}ms`} />
        <Stat label={t("monitor_tokens")} value={metrics.tokens.toLocaleString()} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="text-heading-14">{t("monitor_request_timeline")}</h3>
          <div className="mt-3">
            <Timeline logs={filtered} />
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="text-heading-14">{t("monitor_by_source")}</h3>
          <div className="mt-3">
            <BarChart data={bySource.slice(0, 8)} empty={t("monitor_no_data")} />
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="text-heading-14">{t("monitor_by_model")}</h3>
          <div className="mt-3">
            <BarChart data={byModel} empty={t("monitor_no_data")} />
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="text-heading-14">{t("monitor_token_by_model")}</h3>
          <div className="mt-3">
            <BarChart
              data={tokenByModel.map((d) => ({ ...d, hint: d.value.toLocaleString() }))}
              empty={t("monitor_no_tokens")}
            />
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-3">
            <h3 className="text-heading-14">{t("monitor_call_records")}</h3>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="h-8 w-48 text-copy-12">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_SOURCES}>
                  {t("monitor_source_all")}
                </SelectItem>
                {bySource.map((s) => (
                  <SelectItem key={s.label} value={s.label}>
                    {s.label} ({s.value})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                download(
                  `unified-logs-${Date.now()}.json`,
                  JSON.stringify(filtered, null, 2),
                  "application/json"
                )
              }
            >
              <Download className="h-3.5 w-3.5" /> JSON
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                download(`unified-logs-${Date.now()}.csv`, toCsv(filtered), "text/csv")
              }
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void clearBodies()}>
              <Eraser className="h-3.5 w-3.5" /> {t("monitor_clear_bodies")}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void clearLogs()}>
              <Trash2 className="h-3.5 w-3.5" /> {t("clear", { ns: "common" })}
            </Button>
          </div>
        </div>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-copy-13">
            <thead className="sticky top-0 bg-chrome text-label-12 text-muted-foreground">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
                <th>{t("monitor_time_col")}</th>
                <th>{t("monitor_source_col")}</th>
                <th>{t("monitor_model_col")}</th>
                <th>{t("monitor_protocol_col")}</th>
                <th>{t("monitor_status_col")}</th>
                <th className="text-right">{t("monitor_duration_col")}</th>
                <th className="text-right">{t("monitor_tokens_col")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                    {t("monitor_no_calls")}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setSelected(r)}
                    className="cursor-pointer border-t border-border/60 transition-colors hover:bg-secondary/40 [&>td]:px-3 [&>td]:py-1.5"
                  >
                    <td className="tabular-nums text-muted-foreground">
                      {new Date(r.ts).toLocaleTimeString()}
                    </td>
                    <td className="max-w-[180px] truncate" title={r.userAgent}>
                      {sourceLabel(r, builtinLabel, unknownLabel)}
                    </td>
                    <td className="max-w-[260px] truncate font-mono" title={r.exposedModel}>
                      {r.exposedModel}
                    </td>
                    <td>
                      <Badge variant="outline">{r.protocol}</Badge>
                      {r.stream && <span className="ml-1 text-copy-12 text-muted-foreground">stream</span>}
                    </td>
                    <td>
                      {isOk(r) ? (
                        <Badge variant="success">{r.status}</Badge>
                      ) : (
                        <Badge variant="destructive" title={r.error}>
                          {r.error ? "err" : r.status}
                        </Badge>
                      )}
                    </td>
                    <td className="text-right tabular-nums">{r.durationMs}ms</td>
                    <td className="text-right tabular-nums">{r.totalTokens ?? "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <CallDetailDialog
        record={selected}
        onClose={() => setSelected(null)}
        sourceLabelFor={(r) => sourceLabel(r, builtinLabel, unknownLabel)}
      />
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-2 last:border-b-0">
      <span className="shrink-0 text-label-13 text-muted-foreground">{label}</span>
      <span className={`text-right text-copy-13 ${mono ? "font-mono break-all" : ""}`}>{value}</span>
    </div>
  );
}

/** Pretty-print JSON bodies; fall back to the raw string when not JSON. */
function formatBody(raw: string): string {
  const trimmed = raw.trim();
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return raw;
  }
}

function BodyBlock({ title, body }: { title: string; body: string }) {
  return (
    <section>
      <h4 className="mb-1 text-label-12 uppercase tracking-wide text-muted-foreground">{title}</h4>
      <pre className="max-h-64 overflow-auto rounded-sm border border-border bg-secondary/40 p-3 text-copy-12 leading-relaxed">
        <code className="whitespace-pre-wrap break-words font-mono">{formatBody(body)}</code>
      </pre>
    </section>
  );
}

function CallDetailDialog({
  record,
  onClose,
  sourceLabelFor,
}: {
  record: CallLogRecord | null;
  onClose: () => void;
  sourceLabelFor: (r: CallLogRecord) => string;
}) {
  const { t } = useTranslation("pages");
  const r = record;
  const ok = r ? isOk(r) : false;

  const [body, setBody] = useState<CallBody | null>(null);
  const [loadingBody, setLoadingBody] = useState(false);

  useEffect(() => {
    if (!r || (!r.hasRequestBody && !r.hasResponseBody)) {
      setBody(null);
      return;
    }
    let cancelled = false;
    setLoadingBody(true);
    setBody(null);
    getCallBody(r.id)
      .then((b) => {
        if (!cancelled) setBody(b);
      })
      .catch(() => {
        if (!cancelled) setBody(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingBody(false);
      });
    return () => {
      cancelled = true;
    };
  }, [r]);

  const hasAnyBody = !!r && (r.hasRequestBody || r.hasResponseBody);
  return (
    <Dialog open={!!record} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("monitor_detail_title")}</DialogTitle>
          {r && (
            <DialogDescription className="font-mono text-copy-12">
              {new Date(r.ts).toLocaleString()}
            </DialogDescription>
          )}
        </DialogHeader>
        {r && (
          <div className="max-h-[70vh] space-y-5 overflow-auto pr-1">
            <section>
              <h4 className="mb-1 text-label-12 uppercase tracking-wide text-muted-foreground">
                {t("monitor_detail_request")}
              </h4>
              <DetailRow label={t("monitor_detail_source")} value={sourceLabelFor(r)} />
              <DetailRow label={t("monitor_detail_exposed_model")} value={r.exposedModel} mono />
              <DetailRow label={t("monitor_detail_real_model")} value={r.realModel} mono />
              <DetailRow label={t("monitor_detail_provider")} value={r.provider} />
              <DetailRow
                label={t("monitor_detail_protocol")}
                value={
                  <span className="inline-flex items-center gap-1">
                    <Badge variant="outline">{r.protocol}</Badge>
                  </span>
                }
              />
              <DetailRow
                label={t("monitor_detail_stream")}
                value={r.stream ? t("monitor_detail_yes") : t("monitor_detail_no")}
              />
            </section>

            <section>
              <h4 className="mb-1 text-label-12 uppercase tracking-wide text-muted-foreground">
                {t("monitor_detail_result")}
              </h4>
              <DetailRow
                label={t("monitor_detail_status")}
                value={
                  ok ? (
                    <Badge variant="success">{r.status}</Badge>
                  ) : (
                    <Badge variant="destructive">{r.error ? "err" : r.status}</Badge>
                  )
                }
              />
              <DetailRow label={t("monitor_detail_duration")} value={`${r.durationMs}ms`} />
              {r.error && <DetailRow label={t("monitor_detail_error")} value={r.error} mono />}
            </section>

            <section>
              <h4 className="mb-1 text-label-12 uppercase tracking-wide text-muted-foreground">
                {t("monitor_detail_tokens")}
              </h4>
              <DetailRow
                label={t("monitor_detail_prompt_tokens")}
                value={r.promptTokens?.toLocaleString() ?? "-"}
              />
              <DetailRow
                label={t("monitor_detail_completion_tokens")}
                value={r.completionTokens?.toLocaleString() ?? "-"}
              />
              <DetailRow
                label={t("monitor_detail_total_tokens")}
                value={r.totalTokens?.toLocaleString() ?? "-"}
              />
            </section>

            {r.userAgent && (
              <section>
                <h4 className="mb-1 text-label-12 uppercase tracking-wide text-muted-foreground">
                  {t("monitor_detail_user_agent")}
                </h4>
                <p className="break-all font-mono text-copy-12 text-muted-foreground">
                  {r.userAgent}
                </p>
              </section>
            )}

            {hasAnyBody && loadingBody && (
              <p className="text-copy-12 text-muted-foreground">{t("monitor_detail_body_loading")}</p>
            )}
            {body?.requestBody && (
              <BodyBlock title={t("monitor_detail_request_body")} body={body.requestBody} />
            )}
            {body?.responseBody && (
              <BodyBlock title={t("monitor_detail_response_body")} body={body.responseBody} />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
