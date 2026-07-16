import { useEffect, useState } from "react";
import {
  Activity,
  Boxes,
  Download,
  Globe2,
  MoreHorizontal,
  Pencil,
  Plus,
  Radar,
  Server,
  Terminal,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Reveal } from "@/components/common/Reveal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMcpStore } from "@/store";
import type { McpServer } from "@/types";
import { McpDialog } from "./McpDialog";
import { McpImportDialog } from "./McpImportDialog";
import { McpInspectorDialog } from "./inspector/McpInspectorDialog";
import { BuiltinMcpSection } from "./BuiltinMcpSection";

export function McpPage() {
  const { t } = useTranslation("pages");
  const { items, loaded, load, edit, remove } = useMcpStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<McpServer | null>(null);
  const [deleting, setDeleting] = useState<McpServer | null>(null);
  const [inspecting, setInspecting] = useState<McpServer | null>(null);

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  const enabledCount = items.filter((item) => item.enabled).length;
  const localCount = items.filter((item) => item.transport === "stdio").length;
  const remoteCount = items.length - localCount;

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <section className="relative min-w-0 overflow-hidden rounded-lg border border-border bg-card p-5 shadow-geist-sm">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_12%,rgba(40,169,72,0.16),transparent_34%),linear-gradient(135deg,rgba(23,23,23,0.04),transparent_42%)]" />
        <div className="pointer-events-none absolute right-0 top-0 h-28 w-28 translate-x-8 -translate-y-10 rounded-full border border-border bg-background-secondary" />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl space-y-4">
            <Badge variant="accent" className="rounded-sm uppercase tracking-[0.08em]">
              {t("mcp_page_kicker")}
            </Badge>
            <div className="space-y-2">
              <h1 className="text-heading-32 text-foreground">
                {t("mcp_page_title")}
              </h1>
              <p className="max-w-[62ch] text-copy-14 text-muted-foreground">
                {t("mcp_page_desc")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={openCreate} aria-label={t("mcp_new_server")}>
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">{t("mcp_new_server")}</span>
              </Button>
              <Button
                variant="secondary"
                onClick={() => setImportOpen(true)}
                aria-label={t("mcp_import_action_short")}
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">
                  {t("mcp_import_action_short")}
                </span>
              </Button>
            </div>
          </div>

          <div className="hidden min-w-full grid-cols-2 gap-2 sm:grid sm:grid-cols-4 xl:min-w-[480px]">
            <Metric icon={Boxes} label={t("mcp_total_servers")} value={items.length} />
            <Metric
              icon={Activity}
              label={t("mcp_enabled_servers")}
              value={enabledCount}
            />
            <Metric icon={Terminal} label={t("mcp_local_servers")} value={localCount} />
            <Metric icon={Globe2} label={t("mcp_remote_servers")} value={remoteCount} />
          </div>
        </div>
      </section>

      <BuiltinMcpSection />

      {!loaded ? (
        <McpSkeleton />
      ) : items.length === 0 ? (
        <McpEmptyPanel
          onCreate={openCreate}
          onImport={() => setImportOpen(true)}
        />
      ) : (
        <div className="grid min-w-0 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {items.map((item, i) => (
            <Reveal
              key={item.id}
              index={i}
              className="h-full min-w-0"
            >
              <article className="group flex h-full min-h-[214px] min-w-0 flex-col justify-between rounded-md border border-border bg-card p-4 shadow-geist-sm transition-[transform,box-shadow,border-color] duration-200 ease-geist hover:-translate-y-0.5 hover:shadow-geist-md">
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-background-secondary text-foreground shadow-[inset_0_0_0_1px_var(--border)]">
                        {item.transport === "stdio" ? (
                          <Terminal className="h-4 w-4" />
                        ) : (
                          <Globe2 className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <h2 className="truncate text-heading-16 text-foreground">
                            {item.name}
                          </h2>
                      <Badge variant="outline" className="rounded-sm uppercase">
                        {item.transport}
                      </Badge>
                        </div>
                        <p className="mt-1 flex items-center gap-1.5 text-label-12 text-muted-foreground">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              item.enabled ? "bg-success" : "bg-muted-foreground"
                            }`}
                          />
                          {item.enabled
                            ? t("mcp_status_enabled")
                            : t("mcp_status_disabled")}
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={item.enabled}
                      onCheckedChange={(v) => edit(item.id, { enabled: v })}
                    />
                  </div>

                  {item.description && (
                    <p className="line-clamp-2 text-copy-13 text-muted-foreground">
                      {item.description}
                    </p>
                  )}

                  <div className="rounded-sm border border-border bg-background-secondary p-3">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="text-label-12 font-medium text-muted-foreground">
                        {t("mcp_connection_label")}
                      </span>
                      <Badge variant="default" className="hidden rounded-sm sm:inline-flex">
                        {t(`mcp_transport_${item.transport}`)}
                      </Badge>
                    </div>
                    <code className="block max-h-10 overflow-hidden break-all text-label-12 font-mono leading-relaxed text-foreground">
                      {connectionText(item) || t("mcp_no_connection")}
                    </code>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <MiniStat
                      label={t("mcp_args_count")}
                      value={item.args.length}
                    />
                    <MiniStat
                      label={t("mcp_env_count")}
                      value={Object.keys(item.env ?? {}).length}
                    />
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setInspecting(item)}
                    aria-label={t("mcp_inspect")}
                  >
                    <Radar className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{t("mcp_inspect")}</span>
                  </Button>
                  <RowMenu
                    onInspect={() => setInspecting(item)}
                    onEdit={() => {
                      setEditing(item);
                      setDialogOpen(true);
                    }}
                    onDelete={() => setDeleting(item)}
                  />
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      )}

      <McpDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
      />
      <McpImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <McpInspectorDialog
        open={!!inspecting}
        onOpenChange={(o) => !o && setInspecting(null)}
        server={inspecting}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        description={t("confirm_delete_named", { ns: "common", name: deleting?.name ?? "" })}
        onConfirm={() => {
          if (deleting) remove(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}

function connectionText(item: McpServer) {
  if (item.transport === "stdio") {
    return [item.command, ...item.args].filter(Boolean).join(" ");
  }
  return item.url ?? "";
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Boxes;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-sm border border-border bg-background p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-label-12 font-medium text-muted-foreground">
          {label}
        </span>
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="font-mono text-heading-24 tabular-nums text-foreground">
        {value}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-sm bg-background-secondary px-3 py-2">
      <div className="text-label-12 text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-label-14 font-medium tabular-nums">
        {value}
      </div>
    </div>
  );
}

function McpEmptyPanel({
  onCreate,
  onImport,
}: {
  onCreate: () => void;
  onImport: () => void;
}) {
  const { t } = useTranslation("pages");
  return (
    <section className="grid overflow-hidden rounded-lg border border-border bg-card shadow-geist-sm lg:grid-cols-[1fr_360px]">
      <div className="space-y-5 p-6">
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-background-secondary text-foreground shadow-[inset_0_0_0_1px_var(--border)]">
          <Server className="h-5 w-5" />
        </div>
        <div className="max-w-xl space-y-2">
          <h2 className="text-heading-24 text-foreground">
            {t("mcp_empty_title")}
          </h2>
          <p className="text-copy-14 text-muted-foreground">
            {t("mcp_empty_desc")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onCreate} aria-label={t("mcp_new_server")}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{t("mcp_new_server")}</span>
          </Button>
          <Button
            variant="secondary"
            onClick={onImport}
            aria-label={t("mcp_import_action_short")}
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">
              {t("mcp_import_action_short")}
            </span>
          </Button>
        </div>
      </div>
      <div className="hidden border-t border-border bg-background-secondary p-5 sm:block lg:border-l lg:border-t-0">
        <div className="rounded-md border border-border bg-background p-4 font-mono text-label-12 leading-relaxed text-muted-foreground">
          <div className="text-foreground">{`"mcpServers": {`}</div>
          <div className="pl-4">{`"filesystem": {`}</div>
          <div className="pl-8">{`"command": "npx",`}</div>
          <div className="pl-8">{`"args": ["-y", "@modelcontextprotocol/server-filesystem"]`}</div>
          <div className="pl-4">{`}`}</div>
          <div>{`}`}</div>
        </div>
        <p className="mt-3 text-copy-13 text-muted-foreground">
          {t("mcp_empty_hint")}
        </p>
      </div>
    </section>
  );
}

function McpSkeleton() {
  return (
    <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="h-[214px] animate-pulse rounded-md border border-border bg-card p-4"
        >
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-md bg-secondary" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/2 rounded-sm bg-secondary" />
              <div className="h-3 w-1/3 rounded-sm bg-secondary" />
            </div>
          </div>
          <div className="mt-6 h-16 rounded-sm bg-secondary" />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="h-12 rounded-sm bg-secondary" />
            <div className="h-12 rounded-sm bg-secondary" />
          </div>
        </div>
      ))}
    </div>
  );
}

function RowMenu({
  onInspect,
  onEdit,
  onDelete,
}: {
  onInspect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("pages");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("actions", { ns: "common" })}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onInspect}>
          <Radar className="h-4 w-4" />
          {t("mcp_inspect")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onEdit}>
          <Pencil className="h-4 w-4" />
          {t("edit", { ns: "common" })}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
          {t("delete", { ns: "common" })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
