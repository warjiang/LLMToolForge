import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common/EmptyState";
import type {
  McpResourceDef,
  McpResourceTemplateDef,
} from "@/lib/mcpInspector";
import { ResultView } from "./shared";

interface Props {
  resources: McpResourceDef[];
  templates: McpResourceTemplateDef[];
  onRead: (uri: string) => Promise<unknown>;
}

export function ResourcePanel({ resources, templates, onRead }: Props) {
  const { t } = useTranslation("pages");
  const [reading, setReading] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [activeUri, setActiveUri] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const filteredResources = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return resources;
    return resources.filter((resource) => {
      return (
        (resource.name ?? "").toLowerCase().includes(q) ||
        resource.uri.toLowerCase().includes(q) ||
        (resource.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [resources, query]);

  const filteredTemplates = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((template) => {
      return (
        (template.name ?? "").toLowerCase().includes(q) ||
        template.uriTemplate.toLowerCase().includes(q)
      );
    });
  }, [templates, query]);

  const read = async (uri: string) => {
    setReading(uri);
    setActiveUri(uri);
    setError(null);
    setResult(undefined);
    try {
      setResult(await onRead(uri));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(null);
    }
  };

  if (resources.length === 0 && templates.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title={t("mcp_inspector_no_resources")}
        description={t("mcp_inspector_no_resources_desc")}
      />
    );
  }

  return (
    <div className="grid h-full gap-3 overflow-hidden lg:grid-cols-[minmax(320px,420px)_1fr]">
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card shadow-geist-sm">
        <div className="space-y-3 border-b border-border p-3">
          <div>
            <h3 className="text-heading-16 text-foreground">
              {t("mcp_inspector_available_resources")}
            </h3>
            <p className="text-label-12 text-muted-foreground">
              {resources.length} {t("mcp_inspector_resources")} ·{" "}
              {templates.length} {t("mcp_inspector_templates")}
            </p>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("mcp_inspector_search_resources")}
              className="h-8 w-full rounded-sm border border-border bg-background pl-8 pr-2 text-label-13 outline-none transition-shadow focus-visible:shadow-[0_0_0_1px_var(--ring)]"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
          <div className="space-y-2">
            {filteredResources.length === 0 ? (
              <p className="rounded-sm bg-background-secondary px-3 py-4 text-center text-label-12 text-muted-foreground">
                {t("mcp_inspector_no_matches")}
              </p>
            ) : (
              filteredResources.map((r) => (
                <div
                  key={r.uri}
                  className={`rounded-sm border border-border bg-background p-3 transition-colors ${
                    activeUri === r.uri ? "shadow-[inset_3px_0_0_var(--foreground)]" : ""
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-background-secondary text-muted-foreground">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="truncate text-label-13 font-medium">
                          {r.name ?? r.uri}
                        </span>
                        {r.mimeType && (
                          <Badge variant="outline" className="rounded-sm">
                            {r.mimeType}
                          </Badge>
                        )}
                      </div>
                      <code className="mt-1 block truncate text-label-12 text-muted-foreground">
                        {r.uri}
                      </code>
                      {r.description && (
                        <p className="mt-1 line-clamp-2 text-label-12 text-muted-foreground">
                          {r.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    className="mt-3"
                    variant="secondary"
                    size="sm"
                    onClick={() => read(r.uri)}
                    disabled={reading === r.uri}
                  >
                    {reading === r.uri && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    )}
                    {t("mcp_inspector_read")}
                  </Button>
                </div>
              ))
            )}
          </div>

          {filteredTemplates.length > 0 && (
            <div className="space-y-2">
              <span className="text-label-12 font-medium text-muted-foreground">
                {t("mcp_inspector_templates")}
              </span>
              {filteredTemplates.map((tpl) => (
                <div
                  key={tpl.uriTemplate}
                  className="rounded-sm border border-border bg-background p-3"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate text-label-13 font-medium">
                      {tpl.name ?? tpl.uriTemplate}
                    </span>
                    {tpl.mimeType && (
                      <Badge variant="outline" className="rounded-sm">
                        {tpl.mimeType}
                      </Badge>
                    )}
                  </div>
                  <code className="mt-1 block truncate text-label-12 text-muted-foreground">
                    {tpl.uriTemplate}
                  </code>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      <div className="min-h-0 overflow-y-auto rounded-md border border-border bg-card p-4 shadow-geist-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-label-12 font-medium text-muted-foreground">
            {t("mcp_inspector_resource_result")}
          </span>
          {activeUri && (
            <code className="max-w-[65%] truncate text-label-12 text-muted-foreground">
              {activeUri}
            </code>
          )}
        </div>

        {error ? (
          <p className="whitespace-pre-wrap rounded-sm bg-destructive/10 p-3 text-label-12 text-destructive">
            {error}
          </p>
        ) : result !== undefined ? (
          <ResultView result={result} />
        ) : (
          <div className="flex min-h-[260px] items-center justify-center rounded-sm border border-dashed border-border bg-background-secondary p-6 text-center">
            <div className="max-w-sm">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-background text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]">
                <FileText className="h-5 w-5" />
              </div>
              <p className="text-label-13 text-muted-foreground">
                {t("mcp_inspector_read_resource_hint")}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
