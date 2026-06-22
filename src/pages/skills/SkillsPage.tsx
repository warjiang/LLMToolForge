import { useEffect, useState } from "react";
import { Boxes, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
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
import { useSkillStore } from "@/store";
import type { Skill } from "@/types";
import { SkillDialog } from "./SkillDialog";

export function SkillsPage() {
  const { items, loaded, load, edit, remove } = useSkillStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [deleting, setDeleting] = useState<Skill | null>(null);

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
        title="Skills"
        description="为大模型注册可复用的技能/工具能力，并控制启用状态。"
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            新建 Skill
          </Button>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="还没有 Skill"
          description="创建第一个技能，描述它的用途并打上标签便于检索。"
          action={
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              新建 Skill
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <Card key={item.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                    <Boxes className="h-4 w-4" />
                  </div>
                  <span className="text-label-14 font-medium">{item.name}</span>
                </div>
                <RowMenu
                  onEdit={() => {
                    setEditing(item);
                    setDialogOpen(true);
                  }}
                  onDelete={() => setDeleting(item)}
                />
              </div>

              <p className="mt-3 line-clamp-2 min-h-[40px] text-copy-13 text-muted-foreground">
                {item.description || "暂无描述"}
              </p>

              {item.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {item.tags.map((tag) => (
                    <Badge key={tag} variant="accent">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                <span className="text-label-12 text-muted-foreground">
                  {item.enabled ? "已启用" : "已禁用"}
                </span>
                <Switch
                  checked={item.enabled}
                  onCheckedChange={(v) => edit(item.id, { enabled: v })}
                />
              </div>
            </Card>
          ))}
        </div>
      )}

      <SkillDialog
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
  onEdit,
  onDelete,
}: {
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
