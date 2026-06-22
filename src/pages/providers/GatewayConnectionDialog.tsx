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
import { useGatewayStore } from "@/store";
import type { GatewayConnection, GatewayProvider, ProviderMeta } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: ProviderMeta & { id: GatewayProvider };
  editing: GatewayConnection | null;
}

const PLACEHOLDER: Record<GatewayProvider, string> = {
  "new-api": "https://your-new-api-host/v1",
  litellm: "https://your-litellm-host/v1",
};

export function GatewayConnectionDialog({
  open,
  onOpenChange,
  provider,
  editing,
}: Props) {
  const add = useGatewayStore((s) => s.add);
  const edit = useGatewayStore((s) => s.edit);
  const [form, setForm] = useState({ name: "", baseUrl: "", apiKey: "" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setForm(
        editing
          ? {
              name: editing.name,
              baseUrl: editing.baseUrl,
              apiKey: editing.apiKey,
            }
          : { name: "", baseUrl: "", apiKey: "" }
      );
    }
  }, [open, editing]);

  const submit = async () => {
    if (!form.name.trim()) return setError("请填写名称");
    if (!form.baseUrl.trim()) return setError("请填写 Base URL");
    if (!form.apiKey.trim()) return setError("请填写 API Key");

    const payload = {
      name: form.name.trim(),
      provider: provider.id,
      baseUrl: form.baseUrl.trim().replace(/\/+$/, ""),
      apiKey: form.apiKey.trim(),
    };

    if (editing) await edit(editing.id, payload);
    else await add(payload);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? `编辑 ${provider.label} 连接` : `新建 ${provider.label} 连接`}
          </DialogTitle>
          <DialogDescription>
            OpenAI 兼容网关，填写 Base URL 与 API Key，仅保存在本地设备。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="gw-name">名称</Label>
            <Input
              id="gw-name"
              placeholder={`例如：${provider.label} - 主账号`}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="gw-base">Base URL</Label>
            <Input
              id="gw-base"
              placeholder={PLACEHOLDER[provider.id]}
              autoComplete="off"
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            />
            <p className="text-label-12 text-muted-foreground">
              通常以 /v1 结尾，调用 /v1/models 与 /v1/chat/completions。
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="gw-key">API Key</Label>
            <Input
              id="gw-key"
              type="password"
              placeholder="sk-..."
              autoComplete="off"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
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
