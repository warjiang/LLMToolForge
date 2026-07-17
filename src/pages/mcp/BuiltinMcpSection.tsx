import { useState } from "react";
import {
  Globe2,
  Loader2,
  MoreHorizontal,
  Package,
  Pencil,
  RotateCcw,
  Search,
  Terminal,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useBuiltinMcpStore } from "@/store";
import { builtinServers, builtinHasOverrides } from "@/store/builtinMcp";
import type { McpServer } from "@/types";
import {
  BUILTIN_MCP_DEFS,
  builtinNeedsInstall,
  type BuiltinMcpDef,
} from "@/lib/mcp/builtins";

/** Icon per builtin kind. */
function iconFor(def: BuiltinMcpDef) {
  switch (def.kind) {
    case "playwright":
      return Terminal;
    case "web-search":
      return Search;
    case "web-fetch":
      return Globe2;
    default:
      return Package;
  }
}

export function BuiltinMcpSection({
  onEdit,
}: {
  onEdit: (server: McpServer) => void;
}) {
  const { t } = useTranslation("pages");
  const {
    states,
    installing,
    errors,
    setEnabled,
    install,
    uninstall,
    resetOverrides,
  } = useBuiltinMcpStore();

  const servers = builtinServers(states);
  const serverById = new Map(servers.map((s) => [s.id, s]));

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Package className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-heading-16 text-foreground">
          {t("mcp_builtin_title")}
        </h2>
        <Badge variant="outline" className="rounded-sm uppercase">
          {t("mcp_builtin_badge")}
        </Badge>
      </div>
      <p className="max-w-[62ch] text-copy-13 text-muted-foreground">
        {t("mcp_builtin_desc")}
      </p>

      <div className="grid min-w-0 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {BUILTIN_MCP_DEFS.map((def) => (
          <BuiltinCard
            key={def.id}
            def={def}
            installed={states[def.id]?.installed ?? false}
            enabled={states[def.id]?.enabled ?? false}
            installing={installing[def.id] ?? false}
            error={errors[def.id]}
            customized={builtinHasOverrides(states, def.id)}
            onToggle={(v) => setEnabled(def.id, v)}
            onInstall={() => install(def.id).catch(() => {})}
            onUninstall={() => uninstall(def.id)}
            onEdit={() => {
              const server = serverById.get(def.id);
              if (server) onEdit(server);
            }}
            onReset={() => resetOverrides(def.id)}
          />
        ))}
      </div>
    </section>
  );
}

function BuiltinCard({
  def,
  installed,
  enabled,
  installing,
  error,
  customized,
  onToggle,
  onInstall,
  onUninstall,
  onEdit,
  onReset,
}: {
  def: BuiltinMcpDef;
  installed: boolean;
  enabled: boolean;
  installing: boolean;
  error?: string;
  customized: boolean;
  onToggle: (v: boolean) => void;
  onInstall: () => void;
  onUninstall: () => void;
  onEdit: () => void;
  onReset: () => void;
}) {
  const { t } = useTranslation("pages");
  const [showLog, setShowLog] = useState(false);
  const Icon = iconFor(def);
  const needsInstall = builtinNeedsInstall(def);

  return (
    <article className="group flex h-full min-h-[214px] min-w-0 flex-col justify-between rounded-md border border-border bg-card p-4 shadow-geist-sm">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-background-secondary text-foreground shadow-[inset_0_0_0_1px_var(--border)]">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h3 className="truncate text-heading-16 text-foreground">
                  {def.name}
                </h3>
                <Badge variant="outline" className="rounded-sm uppercase">
                  {def.runtime === "local"
                    ? t("mcp_builtin_local")
                    : def.transport}
                </Badge>
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-label-12 text-muted-foreground">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    enabled ? "bg-success" : "bg-muted-foreground"
                  }`}
                />
                {enabled
                  ? t("mcp_status_enabled")
                  : installed
                    ? t("mcp_status_disabled")
                    : t("mcp_builtin_not_installed")}
              </p>
            </div>
          </div>
          <Switch
            checked={enabled}
            disabled={!installed}
            onCheckedChange={onToggle}
          />
        </div>

        <p className="line-clamp-3 text-copy-13 text-muted-foreground">
          {def.description}
        </p>

        {error && (
          <div className="rounded-sm border border-destructive/40 bg-destructive/5 p-2">
            <button
              className="text-label-12 font-medium text-destructive"
              onClick={() => setShowLog((s) => !s)}
            >
              {t("mcp_builtin_install_failed")}
            </button>
            {showLog && (
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-label-12 font-mono text-muted-foreground">
                {error}
              </pre>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex min-w-0 items-center gap-2">
          {customized && (
            <Badge variant="default" className="rounded-sm">
              {t("mcp_builtin_customized")}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {needsInstall ? (
            installed ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={onUninstall}
                disabled={installing}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("mcp_builtin_uninstall")}
              </Button>
            ) : (
              <Button size="sm" onClick={onInstall} disabled={installing}>
                {installing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Package className="h-3.5 w-3.5" />
                )}
                {installing
                  ? t("mcp_builtin_installing")
                  : t("mcp_builtin_install")}
              </Button>
            )
          ) : (
            <span className="text-label-12 text-muted-foreground">
              {t("mcp_builtin_ready")}
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("mcp_edit_title")}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="h-4 w-4" />
                {t("edit", { ns: "common" })}
              </DropdownMenuItem>
              {customized && (
                <DropdownMenuItem onClick={onReset}>
                  <RotateCcw className="h-4 w-4" />
                  {t("mcp_builtin_reset")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </article>
  );
}
