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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApiKeyStore } from "@/store";
import { PROVIDERS, type ApiKey } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: ApiKey | null;
}

const empty = {
  name: "",
  provider: PROVIDERS[0] as string,
  key: "",
  baseUrl: "",
  note: "",
};

export function ApiKeyDialog({ open, onOpenChange, editing }: Props) {
  const add = useApiKeyStore((s) => s.add);
  const edit = useApiKeyStore((s) => s.edit);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setForm(
        editing
          ? {
              name: editing.name,
              provider: editing.provider,
              key: editing.key,
              baseUrl: editing.baseUrl ?? "",
              note: editing.note ?? "",
            }
          : empty
      );
    }
  }, [open, editing]);

  const submit = async () => {
    if (!form.name.trim()) return setError("请填写名称");
    if (!form.key.trim()) return setError("请填写密钥");

    const payload = {
      name: form.name.trim(),
      provider: form.provider,
      key: form.key.trim(),
      baseUrl: form.baseUrl.trim() || undefined,
      note: form.note.trim() || undefined,
    };

    if (editing) await edit(editing.id, payload);
    else await add(payload);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "编辑 API Key" : "新建 API Key"}</DialogTitle>
          <DialogDescription>
            密钥仅存储在本地设备，列表中以掩码展示。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="ak-name">名称</Label>
            <Input
              id="ak-name"
              placeholder="例如：生产环境 OpenAI"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>提供商</Label>
            <Select
              value={form.provider}
              onValueChange={(v) => setForm({ ...form, provider: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ak-key">密钥</Label>
            <Input
              id="ak-key"
              type="password"
              placeholder="sk-..."
              autoComplete="off"
              value={form.key}
              onChange={(e) => setForm({ ...form, key: e.target.value })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ak-base">Base URL（可选）</Label>
            <Input
              id="ak-base"
              placeholder="https://api.openai.com/v1"
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
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
