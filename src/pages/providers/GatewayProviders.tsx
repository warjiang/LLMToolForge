import { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Plug,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModelFeatureBadges } from "@/components/common/ModelFeatureBadges";
import { ModelIcon, ProviderIcon } from "@/components/common/ProviderModelIcon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useGatewayStore } from "@/store";
import type {
  GatewayConnection,
  GatewayProvider,
  ProviderMeta,
} from "@/types";
import { cn } from "@/lib/utils";
import { getAdapter } from "@/lib/providers";
import type { ModelInfo } from "@/lib/providers/types";
import { GatewayConnectionDialog } from "./GatewayConnectionDialog";

export function GatewayProviders({
  provider,
}: {
  provider: ProviderMeta & { id: GatewayProvider };
}) {
  const { t } = useTranslation("pages");
  const { items, loaded, load } = useGatewayStore();
  const remove = useGatewayStore((s) => s.remove);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GatewayConnection | null>(null);
  const [deleting, setDeleting] = useState<GatewayConnection | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  const conns = useMemo(
    () => items.filter((c) => c.provider === provider.id),
    [items, provider.id]
  );

  useEffect(() => {
    if (!conns.some((c) => c.id === selectedId)) {
      setSelectedId(conns[0]?.id ?? null);
    }
  }, [conns, selectedId]);

  const selected = conns.find((c) => c.id === selectedId) ?? null;

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border pb-4">
        <p className="text-label-13 text-muted-foreground">
          {t(provider.description, { ns: "pages" })}{t("gw_provider_suffix")}
        </p>
        {conns.length > 0 && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t("gw_new_conn")}
          </Button>
        )}
      </div>

      {conns.length === 0 ? (
        <EmptyState
          icon={Plug}
          title={t("gw_empty_title", { label: provider.label })}
          description={t("gw_empty_desc")}
          action={
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t("gw_new_conn")}
            </Button>
          }
        />
      ) : (
        <div className="flex min-h-0 flex-1 gap-4 pt-4">
          <div className="flex w-[260px] shrink-0 flex-col gap-2 overflow-y-auto pr-1">
            {conns.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  "group flex items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-all duration-200 ease-geist active:scale-[0.99]",
                  c.id === selectedId
                    ? "border-foreground/20 bg-secondary"
                    : "border-border hover:bg-secondary/50"
                )}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
                  <ProviderIcon provider={c.provider} className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-label-14 font-medium">
                    {c.name}
                  </div>
                  <div className="truncate text-label-12 text-muted-foreground">
                    {c.baseUrl}
                  </div>
                </div>
                <RowMenu
                  onEdit={() => {
                    setEditing(c);
                    setDialogOpen(true);
                  }}
                  onDelete={() => setDeleting(c)}
                />
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {selected && <ConnectionDetail connection={selected} />}
          </div>
        </div>
      )}

      <GatewayConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        provider={provider}
        editing={editing}
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

function ConnectionDetail({ connection }: { connection: GatewayConnection }) {
  const { t } = useTranslation("pages");
  const edit = useGatewayStore((s) => s.edit);
  const [models, setModels] = useState<ModelInfo[]>(connection.models ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setModels(connection.models ?? []);
    setError(null);
  }, [connection.id, connection.models]);

  const fetchModels = async () => {
    setError(null);
    setLoading(true);
    try {
      const adapter = getAdapter(connection.provider);
      if (!adapter) throw new Error(t("gw_adapter_not_found", { provider: connection.provider }));
      const list = await adapter.listModels({
        baseUrl: connection.baseUrl,
        apiKey: connection.apiKey,
      });
      setModels(list);
      await edit(connection.id, { models: list });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("gw_fetch_failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-5">
      {error && (
        <div className="mb-4 rounded-sm border border-destructive/30 bg-destructive/10 px-3 py-2 text-label-13 text-destructive">
          {error}
        </div>
      )}
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-label-13 text-muted-foreground">
          <Boxes className="h-3.5 w-3.5" />
          {t("gw_available_models")} {models.length > 0 && `(${models.length})`}
        </p>
        <Button size="sm" variant="secondary" onClick={fetchModels} disabled={loading}>
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {t("gw_fetch_models")}
        </Button>
      </div>
      {models.length === 0 ? (
        <p className="py-8 text-center text-label-13 text-muted-foreground">
          {t("gw_models_hint")}
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {models.map((m) => (
            <div key={m.id} className="flex flex-col gap-1.5 py-3">
              <div className="flex items-center gap-2">
                <ModelIcon model={m} className="h-4 w-4" />
                <span className="text-label-14 font-medium">{m.name}</span>
              </div>
              <ModelFeatureBadges model={m} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function RowMenu({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("pages");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-background group-hover:opacity-100"
          aria-label={t("actions", { ns: "common" })}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
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
