import { useEffect, useState } from "react";
import {
  Copy,
  KeyRound,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ProviderIcon } from "@/components/common/ProviderModelIcon";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApiKeyStore } from "@/store";
import type { ApiKey } from "@/types";
import { formatDate, maskSecret } from "@/lib/utils";
import { ApiKeyDialog } from "@/pages/api-keys/ApiKeyDialog";

export function ManualKeyProviders() {
  const { t } = useTranslation("pages");
  const { items, loaded, load } = useApiKeyStore();
  const remove = useApiKeyStore((s) => s.remove);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ApiKey | null>(null);
  const [deleting, setDeleting] = useState<ApiKey | null>(null);

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (item: ApiKey) => {
    setEditing(item);
    setDialogOpen(true);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border pb-4">
        <p className="text-label-13 text-muted-foreground">
          {t("manual_desc")}
        </p>
        {items.length > 0 && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t("manual_new_key")}
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title={t("manual_empty_title")}
          description={t("manual_empty_desc")}
          action={
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t("manual_new_key")}
            </Button>
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pt-4">
          <Card className="divide-y divide-border overflow-hidden">
            {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-4 px-5 py-3.5 transition-colors duration-200 ease-geist hover:bg-secondary/40"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                <ProviderIcon provider={item.provider} className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-label-14 font-medium">
                    {item.name}
                  </span>
                  <Badge variant="outline">{item.provider}</Badge>
                  {item.models && item.models.length > 0 && (
                    <Badge variant="accent">
                      {t("manual_model_count", { count: item.models.length })}
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-label-12 text-muted-foreground">
                  <code className="font-mono">{maskSecret(item.key)}</code>
                  {item.baseUrl && (
                    <span className="truncate">· {item.baseUrl}</span>
                  )}
                </div>
              </div>
              <span className="hidden shrink-0 text-label-12 text-muted-foreground md:block">
                {formatDate(item.updatedAt)}
              </span>
              <RowMenu
                onCopy={() => navigator.clipboard?.writeText(item.key)}
                onEdit={() => openEdit(item)}
                onDelete={() => setDeleting(item)}
              />
            </div>
          ))}
          </Card>
        </div>
      )}

      <ApiKeyDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
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

function RowMenu({
  onCopy,
  onEdit,
  onDelete,
}: {
  onCopy: () => void;
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
        <DropdownMenuItem onClick={onCopy}>
          <Copy className="h-4 w-4" />
          {t("manual_copy_key")}
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
