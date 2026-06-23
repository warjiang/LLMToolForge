import { useEffect, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApiKeyStore } from "@/store";
import { PROVIDERS, type ApiKey } from "@/types";
import { getAdapter } from "@/lib/providers";
import { ModelIcon, ProviderIconLabel } from "@/components/common/ProviderModelIcon";

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
  const [models, setModels] = useState<string[]>([]);
  const [modelInput, setModelInput] = useState("");
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setModelInput("");
      setModels(editing?.models ?? []);
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

  const addModel = (raw: string) => {
    const id = raw.trim();
    if (!id) return;
    setModels((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setModelInput("");
  };

  const removeModel = (id: string) => {
    setModels((prev) => prev.filter((m) => m !== id));
  };

  const fetchModels = async () => {
    setError(null);
    if (!form.baseUrl.trim()) return setError("拉取模型需要先填写 Base URL");
    if (!form.key.trim()) return setError("拉取模型需要先填写密钥");
    setFetching(true);
    try {
      const adapter = getAdapter("manual")!;
      const list = await adapter.listModels({
        baseUrl: form.baseUrl.trim(),
        apiKey: form.key.trim(),
      });
      setModels((prev) => {
        const merged = new Set(prev);
        for (const m of list) merged.add(m.id);
        return [...merged];
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "拉取模型失败");
    } finally {
      setFetching(false);
    }
  };

  const submit = async () => {
    if (!form.name.trim()) return setError("请填写名称");
    if (!form.key.trim()) return setError("请填写密钥");

    const payload = {
      name: form.name.trim(),
      provider: form.provider,
      key: form.key.trim(),
      baseUrl: form.baseUrl.trim() || undefined,
      note: form.note.trim() || undefined,
      models: models.length > 0 ? models : undefined,
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
                    <ProviderIconLabel provider={p}>{p}</ProviderIconLabel>
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
            <Label htmlFor="ak-base">Base URL（OpenAI 兼容，Playground 调用时需要）</Label>
            <Input
              id="ak-base"
              placeholder="https://api.openai.com/v1"
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            />
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="ak-model">可用模型</Label>
              <Button
                size="sm"
                variant="ghost"
                onClick={fetchModels}
                disabled={fetching}
              >
                {fetching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                尝试拉取
              </Button>
            </div>
            <div className="flex gap-2">
              <Input
                id="ak-model"
                placeholder="输入 model id，例如 gpt-4o-mini"
                value={modelInput}
                onChange={(e) => setModelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addModel(modelInput);
                  }
                }}
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() => addModel(modelInput)}
                aria-label="添加模型"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {models.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {models.map((m) => (
                  <Badge key={m} variant="outline" className="gap-1 pr-1">
                    <ModelIcon model={m} className="h-3.5 w-3.5" />
                    {m}
                    <button
                      type="button"
                      onClick={() => removeModel(m)}
                      className="rounded-sm text-muted-foreground hover:text-foreground"
                      aria-label={`移除 ${m}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
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
