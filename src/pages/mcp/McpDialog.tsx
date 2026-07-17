import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { useMcpStore, useBuiltinMcpStore } from "@/store";
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
  const { t } = useTranslation("pages");
  const add = useMcpStore((s) => s.add);
  const edit = useMcpStore((s) => s.edit);
  const setBuiltinOverrides = useBuiltinMcpStore((s) => s.setOverrides);
  const setBuiltinEnabled = useBuiltinMcpStore((s) => s.setEnabled);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);

  const isBuiltin = !!editing?.builtin;

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
  // Local built-ins (web-search/web-fetch) have no command/url to configure.
  const isLocalBuiltin =
    editing?.builtin === "web-search" || editing?.builtin === "web-fetch";

  const submit = async () => {
    if (!form.name.trim()) return setError(t("mcp_name_required"));
    // Local built-ins (web-search/web-fetch) have no command/url to validate.
    if (!isLocalBuiltin && isStdio && !form.command.trim())
      return setError(t("mcp_command_required"));
    if (!isLocalBuiltin && !isStdio && !form.url.trim())
      return setError(t("mcp_url_required"));

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

    // Built-ins are not stored in the synced repo; persist edits as overrides
    // on the local builtin store and route the enable flag through its gate.
    if (isBuiltin && editing) {
      setBuiltinOverrides(editing.id, {
        description: form.description.trim() || undefined,
        command: isStdio ? form.command.trim() : undefined,
        args: isStdio ? parseArgs(form.args) : undefined,
        env: parseEnv(form.env),
        url: !isStdio ? form.url.trim() || undefined : undefined,
      });
      setBuiltinEnabled(editing.id, form.enabled);
      onOpenChange(false);
      return;
    }

    if (editing) await edit(editing.id, payload);
    else await add({ ...payload, installed: false });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing ? t("mcp_edit_title") : t("mcp_create_title")}
          </DialogTitle>
          <DialogDescription>
            {t("mcp_dialog_desc")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="mcp-name">{t("name", { ns: "common" })}</Label>
            <Input
              id="mcp-name"
              placeholder="filesystem"
              value={form.name}
              disabled={isBuiltin}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="mcp-desc">
              {t("mcp_description_label")}
            </Label>
            <Textarea
              id="mcp-desc"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </div>

          {!isLocalBuiltin && (
            <>
              <div className="grid gap-1.5">
                <Label>{t("mcp_transport_label")}</Label>
                <Select
                  value={form.transport}
                  disabled={isBuiltin}
                  onValueChange={(v) =>
                    setForm({ ...form, transport: v as McpTransport })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MCP_TRANSPORTS.map((transport) => (
                      <SelectItem key={transport.value} value={transport.value}>
                        {t(transport.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {isStdio ? (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="mcp-cmd">{t("mcp_command_label")}</Label>
                    <Input
                      id="mcp-cmd"
                      placeholder={t("mcp_command_placeholder")}
                      value={form.command}
                      onChange={(e) =>
                        setForm({ ...form, command: e.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="mcp-args">{t("mcp_args_label")}</Label>
                    <Input
                      id="mcp-args"
                      placeholder={t("mcp_args_placeholder")}
                      value={form.args}
                      onChange={(e) => setForm({ ...form, args: e.target.value })}
                    />
                  </div>
                </>
              ) : (
                <div className="grid gap-1.5">
                  <Label htmlFor="mcp-url">{t("mcp_url_label")}</Label>
                  <Input
                    id="mcp-url"
                    placeholder="https://example.com/mcp"
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                  />
                </div>
              )}

              <div className="grid gap-1.5">
                <Label htmlFor="mcp-env">{t("mcp_env_label")}</Label>
                <Textarea
                  id="mcp-env"
                  placeholder={t("mcp_env_placeholder")}
                  value={form.env}
                  onChange={(e) => setForm({ ...form, env: e.target.value })}
                />
              </div>
            </>
          )}

          <div className="flex items-center justify-between rounded-sm border border-border px-3 py-2.5">
            <div className="space-y-0.5">
              <Label>{t("mcp_enable_label")}</Label>
              <p className="text-label-12 text-muted-foreground">
                {t("mcp_disabled_hint")}
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
            {t("cancel", { ns: "common" })}
          </Button>
          <Button onClick={submit}>{editing ? t("save", { ns: "common" }) : t("create", { ns: "common" })}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
