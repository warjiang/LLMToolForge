import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, MessageSquare, Play, Search, TextCursorInput } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/EmptyState";
import type { McpPromptDef } from "@/lib/mcpInspector";
import { ExpandableText, ResultView } from "./shared";

interface Props {
  prompts: McpPromptDef[];
  onGet: (name: string, args: Record<string, string>) => Promise<unknown>;
}

export function PromptPanel({ prompts, onGet }: Props) {
  const { t } = useTranslation("pages");
  const [selected, setSelected] = useState<string | null>(
    prompts[0]?.name ?? null
  );
  const [query, setQuery] = useState("");
  const filteredPrompts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return prompts;
    return prompts.filter((prompt) => {
      return (
        prompt.name.toLowerCase().includes(q) ||
        (prompt.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [prompts, query]);

  const prompt = useMemo(
    () => prompts.find((p) => p.name === selected) ?? null,
    [prompts, selected]
  );

  useEffect(() => {
    if (!prompt) setSelected(prompts[0]?.name ?? null);
  }, [prompt, prompts]);

  if (prompts.length === 0) {
    return (
      <EmptyState
        icon={MessageSquare}
        title={t("mcp_inspector_no_prompts")}
        description={t("mcp_inspector_no_prompts_desc")}
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
              placeholder={t("mcp_inspector_search_prompts")}
              className="h-8 w-full rounded-sm border border-border bg-background pl-8 pr-2 text-label-13 outline-none transition-shadow focus-visible:shadow-[0_0_0_1px_var(--ring)]"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {filteredPrompts.length === 0 ? (
            <p className="px-2 py-4 text-center text-label-12 text-muted-foreground">
              {t("mcp_inspector_no_matches")}
            </p>
          ) : (
            filteredPrompts.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => setSelected(p.name)}
                className={`mb-1 block w-full rounded-sm px-3 py-2.5 text-left transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--ring)] ${
                  p.name === selected
                    ? "bg-secondary text-foreground shadow-[inset_3px_0_0_var(--foreground)]"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
                title={p.name}
              >
                <span className="block truncate text-label-13 font-medium">
                  {p.name}
                </span>
                {p.description && (
                  <span className="mt-1 block truncate text-label-12 text-muted-foreground">
                    {p.description}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </aside>

      <div className="min-h-0 overflow-y-auto rounded-md border border-border bg-card p-4 shadow-geist-sm">
        {prompt && <PromptDetail key={prompt.name} prompt={prompt} onGet={onGet} />}
      </div>
    </div>
  );
}

function PromptDetail({
  prompt,
  onGet,
}: {
  prompt: McpPromptDef;
  onGet: (name: string, args: Record<string, string>) => Promise<unknown>;
}) {
  const { t } = useTranslation("pages");
  const args = prompt.arguments ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<unknown>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValues({});
    setResult(undefined);
    setError(null);
  }, [prompt.name]);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const payload: Record<string, string> = {};
      for (const a of args) {
        const v = values[a.name];
        if (v != null && v !== "") payload[a.name] = v;
      }
      setResult(await onGet(prompt.name, payload));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(undefined);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-sm border border-border bg-background-secondary p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-background text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]">
            <MessageSquare className="h-4 w-4" />
          </div>
          <h3 className="min-w-0 truncate text-heading-16 text-foreground">
            {prompt.name}
          </h3>
        </div>
        {prompt.description && (
          <div className="mt-3">
            <ExpandableText text={prompt.description} />
          </div>
        )}
      </div>

      {args.length > 0 ? (
        <div className="grid gap-3 rounded-sm border border-border bg-background p-4">
          <div className="inline-flex items-center gap-1.5 text-label-12 font-medium text-muted-foreground">
            <TextCursorInput className="h-3.5 w-3.5" />
            {t("mcp_inspector_arguments")}
          </div>
          {args.map((a) => (
            <div key={a.name} className="grid gap-1">
              <label className="flex items-baseline gap-1.5 text-label-12 font-medium">
                <span>{a.name}</span>
                {a.required && <span className="text-destructive">*</span>}
              </label>
              <input
                value={values[a.name] ?? ""}
                onChange={(e) =>
                  setValues({ ...values, [a.name]: e.target.value })
                }
                className="h-9 rounded-sm border border-border bg-background-secondary px-3 text-label-13 outline-none transition-shadow focus-visible:shadow-[0_0_0_1px_var(--ring)]"
              />
              {a.description && (
                <p className="text-label-12 text-muted-foreground">
                  {a.description}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-sm border border-border bg-background p-4 text-label-12 text-muted-foreground">
          {t("mcp_inspector_no_args")}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={run} disabled={running}>
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {t("mcp_inspector_get_prompt")}
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
