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
import { useVolcCredentialStore } from "@/store";
import { VOLC_REGIONS, type VolcCredential } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: VolcCredential | null;
}

const empty = {
  name: "",
  accessKey: "",
  secretKey: "",
  region: VOLC_REGIONS[0] as string,
};

export function VolcCredentialDialog({ open, onOpenChange, editing }: Props) {
  const add = useVolcCredentialStore((s) => s.add);
  const edit = useVolcCredentialStore((s) => s.edit);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setForm(
        editing
          ? {
              name: editing.name,
              accessKey: editing.accessKey,
              secretKey: editing.secretKey,
              region: editing.region,
            }
          : empty
      );
    }
  }, [open, editing]);

  const submit = async () => {
    if (!form.name.trim()) return setError("请填写名称");
    if (!form.accessKey.trim()) return setError("请填写 AccessKey");
    if (!form.secretKey.trim()) return setError("请填写 SecretKey");

    const payload = {
      name: form.name.trim(),
      accessKey: form.accessKey.trim(),
      secretKey: form.secretKey.trim(),
      region: form.region,
    };

    if (editing) await edit(editing.id, payload);
    else await add({ ...payload, apiKeys: [] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? "编辑火山引擎凭证" : "新建火山引擎凭证"}
          </DialogTitle>
          <DialogDescription>
            AK/SK 用于拉取已开通的模型与 Ark API Key，仅保存在本地设备。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="vc-name">名称</Label>
            <Input
              id="vc-name"
              placeholder="例如：火山方舟 - 主账号"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="vc-ak">AccessKey ID</Label>
            <Input
              id="vc-ak"
              placeholder="AKLT..."
              autoComplete="off"
              value={form.accessKey}
              onChange={(e) => setForm({ ...form, accessKey: e.target.value })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="vc-sk">SecretAccessKey</Label>
            <Input
              id="vc-sk"
              type="password"
              placeholder="••••••••"
              autoComplete="off"
              value={form.secretKey}
              onChange={(e) => setForm({ ...form, secretKey: e.target.value })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>区域 Region</Label>
            <Select
              value={form.region}
              onValueChange={(v) => setForm({ ...form, region: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VOLC_REGIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
