import { useEffect, useMemo } from "react";
import { Download, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useUnifiedStore } from "@/store/unified";
import type { CallLogRecord } from "@/lib/unifiedApi";

function isOk(r: CallLogRecord): boolean {
  return !r.error && r.status >= 200 && r.status < 400;
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
    "exposedModel",
    "provider",
    "protocol",
    "stream",
    "status",
    "durationMs",
    "promptTokens",
    "completionTokens",
    "totalTokens",
    "error",
  ];
  const rows = logs.map((r) =>
    [
      new Date(r.ts).toISOString(),
      r.exposedModel,
      r.provider,
      r.protocol,
      r.stream,
      r.status,
      r.durationMs,
      r.promptTokens ?? "",
      r.completionTokens ?? "",
      r.totalTokens ?? "",
      (r.error ?? "").replace(/"/g, '""'),
    ]
      .map((v) => `"${String(v)}"`)
      .join(",")
  );
  return [head.join(","), ...rows].join("\n");
}

export function MonitorPanel() {
  const logs = useUnifiedStore((s) => s.logs);
  const loadLogs = useUnifiedStore((s) => s.loadLogs);
  const clearLogs = useUnifiedStore((s) => s.clearLogs);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const metrics = useMemo(() => {
    const total = logs.length;
    const ok = logs.filter(isOk).length;
    const durations = logs.map((r) => r.durationMs).sort((a, b) => a - b);
    const avg = total ? Math.round(durations.reduce((a, b) => a + b, 0) / total) : 0;
    const p95 = durations.length
      ? durations[Math.min(durations.length - 1, Math.round(0.95 * (durations.length - 1)))]
      : 0;
    const tokens = logs.reduce((a, r) => a + (r.totalTokens ?? 0), 0);
    return {
      total,
      ok,
      successRate: total ? Math.round((ok / total) * 100) : 0,
      avg,
      p95,
      tokens,
    };
  }, [logs]);

  const byModel = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of logs) map.set(r.exposedModel, (map.get(r.exposedModel) ?? 0) + 1);
    return [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [logs]);

  const tokenByModel = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of logs)
      map.set(r.exposedModel, (map.get(r.exposedModel) ?? 0) + (r.totalTokens ?? 0));
    return [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [logs]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="总请求" value={String(metrics.total)} />
        <Stat label="成功率" value={`${metrics.successRate}%`} sub={`${metrics.ok}/${metrics.total}`} />
        <Stat label="平均耗时" value={`${metrics.avg}ms`} />
        <Stat label="P95 耗时" value={`${metrics.p95}ms`} />
        <Stat label="累计 Tokens" value={metrics.tokens.toLocaleString()} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="text-heading-14">请求量（近 30 分钟）</h3>
          <div className="mt-3">
            <Timeline logs={logs} />
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="text-heading-14">按模型请求数（Top 8）</h3>
          <div className="mt-3">
            <BarChart data={byModel} empty="暂无调用" />
          </div>
        </Card>
        <Card className="p-5 lg:col-span-2">
          <h3 className="text-heading-14">Token 消耗（Top 8）</h3>
          <div className="mt-3">
            <BarChart
              data={tokenByModel.map((d) => ({ ...d, hint: d.value.toLocaleString() }))}
              empty="暂无 token 统计"
            />
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-heading-14">调用记录</h3>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                download(
                  `unified-logs-${Date.now()}.json`,
                  JSON.stringify(logs, null, 2),
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
                download(`unified-logs-${Date.now()}.csv`, toCsv(logs), "text/csv")
              }
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void clearLogs()}>
              <Trash2 className="h-3.5 w-3.5" /> 清空
            </Button>
          </div>
        </div>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-copy-13">
            <thead className="sticky top-0 bg-chrome text-label-12 text-muted-foreground">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
                <th>时间</th>
                <th>模型</th>
                <th>协议</th>
                <th>状态</th>
                <th className="text-right">耗时</th>
                <th className="text-right">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    暂无调用记录
                  </td>
                </tr>
              ) : (
                logs.map((r) => (
                  <tr key={r.id} className="border-t border-border/60 [&>td]:px-3 [&>td]:py-1.5">
                    <td className="tabular-nums text-muted-foreground">
                      {new Date(r.ts).toLocaleTimeString()}
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
    </div>
  );
}
