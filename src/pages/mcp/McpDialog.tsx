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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMcpStore } from "@/store";
import { MCP_TRANSPORTS, type McpServer, type McpTransport } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: McpServer | null;
}

const empty = {
  name: "",
  description: "",
  transport: "stdio" as McpTransport,
  command: "",
  args: "",
  url: "",
  env: "",
  enabled: true,
};

function parseArgs(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((a) => a.trim())
    .filter(Boolean);
}

function parseEnv(raw: string): Record<string, string> {
  const env: Record<string, string> = {};
  raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const idx = line.indexOf("=");
      if (idx > 0) env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });
  return env;
}

function stringifyEnv(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

export function McpDialog({ open, onOpenChange, editing }: Props) {
  const add = useMcpStore((s) => s.add);
  const edit = useMcpStore((s) => s.edit);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setForm(
        editing
          ? {
              name: editing.name,
              description: editing.description ?? "",
              transport: editing.transport,
              command: editing.command ?? "",
              args: editing.args.join(" "),
              url: editing.url ?? "",
              env: stringifyEnv(editing.env),
              enabled: editing.enabled,
            }
          : empty
      );
    }
  }, [open, editing]);

  const isStdio = form.transport === "stdio";

  const submit = async () => {
    if (!form.name.trim()) return setError("请填写名称");
    if (isStdio && !form.command.trim()) return setError("请填写启动命令");
    if (!isStdio && !form.url.trim()) return setError("请填写服务器 URL");

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      transport: form.transport,
      command: isStdio ? form.command.trim() : undefined,
      args: isStdio ? parseArgs(form.args) : [],
      url: !isStdio ? form.url.trim() : undefined,
      env: parseEnv(form.env),
      enabled: form.enabled,
    };

    if (editing) await edit(editing.id, payload);
    else await add(payload);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing ? "编辑 MCP Server" : "新建 MCP Server"}
          </DialogTitle>
          <DialogDescription>
            配置 MCP 服务器连接方式，stdio 用于本地进程，SSE/HTTP 用于远程服务。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="mcp-name">名称</Label>
            <Input
              id="mcp-name"
              placeholder="例如：filesystem"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>传输方式</Label>
            <Select
              value={form.transport}
              onValueChange={(v) =>
                setForm({ ...form, transport: v as McpTransport })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MCP_TRANSPORTS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isStdio ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="mcp-cmd">启动命令</Label>
                <Input
                  id="mcp-cmd"
                  placeholder="例如：npx"
                  value={form.command}
                  onChange={(e) =>
                    setForm({ ...form, command: e.target.value })
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="mcp-args">参数</Label>
                <Input
                  id="mcp-args"
                  placeholder="空格分隔，例如：-y @modelcontextprotocol/server-filesystem"
                  value={form.args}
                  onChange={(e) => setForm({ ...form, args: e.target.value })}
                />
              </div>
            </>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="mcp-url">服务器 URL</Label>
              <Input
                id="mcp-url"
                placeholder="https://example.com/mcp"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="mcp-env">环境变量（可选）</Label>
            <Textarea
              id="mcp-env"
              placeholder={"每行一个 KEY=VALUE\n例如：API_TOKEN=xxx"}
              value={form.env}
              onChange={(e) => setForm({ ...form, env: e.target.value })}
            />
          </div>

          <div className="flex items-center justify-between rounded-sm border border-border px-3 py-2.5">
            <div className="space-y-0.5">
              <Label>启用</Label>
              <p className="text-label-12 text-muted-foreground">
                禁用后不会连接该服务器。
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
