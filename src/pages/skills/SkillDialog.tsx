import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useSkillStore } from "@/store";
import type { Skill } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Skill | null;
}

const empty = {
  name: "",
  description: "",
  tags: "",
  content: "",
  enabled: true,
};

function parseTags(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[,，\s]+/)
        .map((t) => t.trim())
        .filter(Boolean)
    )
  );
}

export function SkillDialog({ open, onOpenChange, editing }: Props) {
  const add = useSkillStore((s) => s.add);
  const edit = useSkillStore((s) => s.edit);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setForm(
        editing
          ? {
              name: editing.name,
              description: editing.description,
              tags: editing.tags.join(", "),
              content: editing.content ?? "",
              enabled: editing.enabled,
            }
          : empty
      );
    }
  }, [open, editing]);

  const submit = async () => {
    if (!form.name.trim()) return setError("请填写名称");

    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      tags: parseTags(form.tags),
      content: form.content.trim() || undefined,
      enabled: form.enabled,
    };

    if (editing) await edit(editing.id, payload);
    else await add(payload);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "编辑 Skill" : "新建 Skill"}</DialogTitle>
          <DialogDescription>
            定义技能的名称、用途和标签，供大模型按需调用。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="sk-name">名称</Label>
            <Input
              id="sk-name"
              placeholder="例如：网页搜索"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="sk-desc">描述</Label>
            <Textarea
              id="sk-desc"
              placeholder="这个技能做什么、何时使用…"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="sk-tags">标签</Label>
            <Input
              id="sk-tags"
              placeholder="用逗号或空格分隔，例如：search, web"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
            />
          </div>

          <div className="flex items-center justify-between rounded-sm border border-border px-3 py-2.5">
            <div className="space-y-0.5">
              <Label>启用</Label>
              <p className="text-label-12 text-muted-foreground">
                禁用后大模型将不会调用此技能。
              </p>
            </div>
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => setForm({ ...form, enabled: v })}
            />
          </div>

          {error && <p className="text-label-13 text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit}>{editing ? "保存" : "创建"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
