import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Braces, Loader2, Play, Search, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/EmptyState";
import type { McpToolDef } from "@/lib/mcpInspector";
import {
  buildArguments,
  defaultForSchema,
  ExpandableText,
  ResultView,
  SchemaForm,
} from "./shared";

interface Props {
  tools: McpToolDef[];
  onCall: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

export function ToolPanel({ tools, onCall }: Props) {
  const { t } = useTranslation("pages");
  const [selected, setSelected] = useState<string | null>(
    tools[0]?.name ?? null
  );
  const [query, setQuery] = useState("");

  const filteredTools = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter((tool) => {
      return (
        tool.name.toLowerCase().includes(q) ||
        (tool.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [tools, query]);

  const tool = useMemo(
    () => tools.find((x) => x.name === selected) ?? null,
    [tools, selected]
  );

  useEffect(() => {
    if (!tool) setSelected(tools[0]?.name ?? null);
  }, [tool, tools]);

  if (tools.length === 0) {
    return (
      <EmptyState
        icon={Wrench}
        title={t("mcp_inspector_no_tools")}
        description={t("mcp_inspector_no_tools_desc")}
      />
    );
  }

  return (
    <div className="grid h-full gap-3 overflow-hidden lg:grid-cols-[280px_1fr]">
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card shadow-geist-sm">
        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("mcp_inspector_search_tools")}
              className="h-8 w-full rounded-sm border border-border bg-background pl-8 pr-2 text-label-13 outline-none transition-shadow focus-visible:shadow-[0_0_0_1px_var(--ring)]"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {filteredTools.length === 0 ? (
            <p className="px-2 py-4 text-center text-label-12 text-muted-foreground">
              {t("mcp_inspector_no_matches")}
            </p>
          ) : (
            filteredTools.map((x) => (
              <button
                key={x.name}
                type="button"
                onClick={() => setSelected(x.name)}
                className={`mb-1 block w-full rounded-sm px-3 py-2.5 text-left transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--ring)] ${
                  x.name === selected
                    ? "bg-secondary text-foreground shadow-[inset_3px_0_0_var(--foreground)]"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
                title={x.name}
              >
                <span className="block truncate text-label-13 font-medium">
                  {x.name}
                </span>
                {x.description && (
                  <span className="mt-1 block truncate text-label-12 text-muted-foreground">
                    {x.description}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </aside>

      <div className="min-h-0 overflow-y-auto rounded-md border border-border bg-card p-4 shadow-geist-sm">
        {tool && <ToolDetail key={tool.name} tool={tool} onCall={onCall} />}
      </div>
    </div>
  );
}

function ToolDetail({
  tool,
  onCall,
}: {
  tool: McpToolDef;
  onCall: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}) {
  const { t } = useTranslation("pages");
  const schema = tool.inputSchema;

  const initialValues = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(schema?.properties ?? {})) {
      out[key] = defaultForSchema(prop);
    }
    return out;
  }, [schema]);

  const [values, setValues] = useState<Record<string, unknown>>(initialValues);
  const [rawMode, setRawMode] = useState(false);
  const [rawText, setRawText] = useState("{}");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<unknown>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValues(initialValues);
    setRawText("{}");
    setRawMode(false);
    setResult(undefined);
    setError(null);
  }, [initialValues]);

  const run = async () => {
    setError(null);
    let args: Record<string, unknown>;
    try {
      if (rawMode) {
        const text = rawText.trim() || "{}";
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        } else {
          throw new Error("arguments must be a JSON object");
        }
      } else {
        args = buildArguments(schema, values);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }

    setRunning(true);
    try {
      const res = await onCall(tool.name, args);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(undefined);
    } finally {
      setRunning(false);
    }
  };

  const toggleRaw = () => {
    if (!rawMode) {
      try {
        setRawText(JSON.stringify(buildArguments(schema, values), null, 2));
      } catch {
        setRawText("{}");
      }
    }
    setRawMode((m) => !m);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-sm border border-border bg-background-secondary p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-background text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]">
            <Wrench className="h-4 w-4" />
          </div>
          <h3 className="min-w-0 truncate text-heading-16 text-foreground">
            {tool.name}
          </h3>
        </div>
        {tool.description && (
          <div className="mt-3">
            <ExpandableText text={tool.description} />
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-sm border border-border bg-background p-4">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-label-12 font-medium text-muted-foreground">
            <Braces className="h-3.5 w-3.5" />
            {t("mcp_inspector_arguments")}
          </span>
          <Button variant="ghost" size="sm" onClick={toggleRaw}>
            {rawMode
              ? t("mcp_inspector_form_mode")
              : t("mcp_inspector_raw_mode")}
          </Button>
        </div>

        {rawMode ? (
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            className="min-h-[160px] w-full rounded-sm border border-border bg-background-secondary px-3 py-2 text-label-12 font-mono outline-none transition-shadow focus-visible:shadow-[0_0_0_1px_var(--ring)]"
          />
        ) : (
          <SchemaForm schema={schema} values={values} onChange={setValues} />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={run} disabled={running}>
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {t("mcp_inspector_run_tool")}
        </Button>
      </div>

      {(error || result !== undefined) && (
        <div className="space-y-3 rounded-sm border border-border bg-background p-4">
          <span className="text-label-12 font-medium text-muted-foreground">
            {t("mcp_inspector_result")}
          </span>
          {error && (
            <p className="whitespace-pre-wrap rounded-sm bg-destructive/10 p-3 text-label-12 text-destructive">
              {error}
            </p>
          )}
          {result !== undefined && <ResultView result={result} />}
        </div>
      )}
    </div>
  );
}
