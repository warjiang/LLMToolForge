import { useEffect, useState } from "react";
import { MoreHorizontal, Pencil, Plus, Server, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Reveal } from "@/components/common/Reveal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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

export function McpPage() {
  const { t } = useTranslation("pages");
  const { items, loaded, load, edit, remove } = useMcpStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<McpServer | null>(null);
  const [deleting, setDeleting] = useState<McpServer | null>(null);

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="MCP Servers"
        description={t("mcp_page_desc")}
        actions={
          items.length > 0 ? (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t("mcp_new_server")}
            </Button>
          ) : undefined
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={Server}
          title={t("mcp_empty_title")}
          description={t("mcp_empty_desc")}
          action={
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t("mcp_new_server")}
            </Button>
          }
        />
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {items.map((item, i) => (
            <Reveal
              key={item.id}
              index={i}
              className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-secondary/40"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                <Server className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-label-14 font-medium">
                    {item.name}
                  </span>
                  <Badge variant="outline" className="uppercase">
                    {item.transport}
                  </Badge>
                </div>
                <div className="mt-0.5 truncate text-label-12 text-muted-foreground">
                  <code className="font-mono">
                    {item.transport === "stdio"
                      ? [item.command, ...item.args].filter(Boolean).join(" ") ||
                        "-"
                      : item.url || "-"}
                  </code>
                </div>
              </div>
              <Switch
                checked={item.enabled}
                onCheckedChange={(v) => edit(item.id, { enabled: v })}
              />
              <RowMenu
                onEdit={() => {
                  setEditing(item);
                  setDialogOpen(true);
                }}
                onDelete={() => setDeleting(item)}
              />
            </Reveal>
          ))}
        </Card>
      )}

      <McpDialog
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
        <Button variant="ghost" size="icon-sm" aria-label={t("actions", { ns: "common" })}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
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
