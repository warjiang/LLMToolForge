import { useEffect, useState } from "react";
import {
  Copy,
  KeyRound,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
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
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-label-13 text-muted-foreground">
          手动录入 API Key 与可用模型（OpenAI 兼容），可直接在 Playground 中使用。
        </p>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          新建 Key
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="还没有 API Key"
          description="添加你的第一个提供商密钥，并配置可用模型。"
          action={
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              新建 Key
            </Button>
          }
        />
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-secondary/40"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                <KeyRound className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-label-14 font-medium">
                    {item.name}
                  </span>
                  <Badge variant="outline">{item.provider}</Badge>
                  {item.models && item.models.length > 0 && (
                    <Badge variant="accent">
                      {item.models.length} 模型
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
      )}

      <ApiKeyDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        description={`确定删除 “${deleting?.name}” 吗？此操作无法撤销。`}
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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="操作">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onCopy}>
          <Copy className="h-4 w-4" />
          复制密钥
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onEdit}>
          <Pencil className="h-4 w-4" />
          编辑
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
          删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
