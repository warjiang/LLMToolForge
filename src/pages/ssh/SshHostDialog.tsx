import { useEffect, useRef, useState } from "react";
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
import { PasswordInput } from "@/components/ui/password-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSshHostStore } from "@/store";
import {
  SSH_AUTH_METHODS,
  SSH_DEFAULT_PORT,
  type SshAuthMethod,
  type SshHost,
} from "@/types";
import { sealHostSecrets } from "@/lib/ssh/client";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: SshHost | null;
  /**
   * When set (and not editing), the dialog opens in "clone" mode: visible
   * fields are pre-filled from this host and its already-sealed secrets are
   * reused, so the user typically only changes the address/name to spin up a
   * near-identical host. Submitting creates a brand new host.
   */
  cloneFrom?: SshHost | null;
}

const empty = {
  name: "",
  hostname: "",
  port: String(SSH_DEFAULT_PORT),
  username: "",
  authMethod: "password" as SshAuthMethod,
  password: "",
  privateKey: "",
  passphrase: "",
  proxyJump: "",
  forwardAgent: false,
  note: "",
};

export function SshHostDialog({ open, onOpenChange, editing, cloneFrom }: Props) {
  const { t } = useTranslation("pages");
  const add = useSshHostStore((s) => s.add);
  const edit = useSshHostStore((s) => s.edit);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // The host whose visible fields / sealed secrets seed this dialog. For an
  // edit that's the host itself; for a clone it's the source host.
  const source = editing ?? (cloneFrom || null);
  const cloning = !editing && !!cloneFrom;

  useEffect(() => {
    if (open) {
      setError(null);
      setForm(
        source
          ? {
              name: cloning ? `${source.name}-copy` : source.name,
              hostname: source.hostname,
              port: String(source.port ?? SSH_DEFAULT_PORT),
              username: source.username,
              authMethod: source.authMethod,
              // Secrets are never shown; blank means "keep/reuse existing".
              password: "",
              privateKey: "",
              passphrase: "",
              proxyJump: source.proxyJump ?? "",
              forwardAgent: source.forwardAgent ?? false,
              note: source.note ?? "",
            }
          : empty
      );
    }
  }, [open, editing, cloneFrom]);

  const secretKept = editing
    ? t("ssh_secret_kept")
    : cloning
      ? t("ssh_secret_inherited")
      : "";

  const onPickKeyFile = () => fileInput.current?.click();
  const onKeyFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () =>
      setForm((f) => ({ ...f, privateKey: String(reader.result ?? "") }));
    reader.readAsText(file);
    e.target.value = "";
  };

  const submit = async () => {
    if (!form.name.trim()) return setError(t("ssh_name_required"));
    if (!form.hostname.trim()) return setError(t("ssh_hostname_required"));
    if (!form.username.trim()) return setError(t("ssh_username_required"));
    if (
      form.authMethod === "key" &&
      !form.privateKey.trim() &&
      !source?.privateKey
    ) {
      return setError(t("ssh_key_required"));
    }

    setBusy(true);
    setError(null);
    try {
      // Seal only the secrets the user actually entered.
      const sealed = await sealHostSecrets({
        password: form.password.trim() || undefined,
        privateKey: form.privateKey.trim() || undefined,
        passphrase: form.passphrase.trim() || undefined,
      });

      // For edits and clones, fall back to the source host's already-sealed
      // value when the user left a secret field blank.
      const keep = (next: string | undefined, prev?: string) =>
        next ?? (source ? prev : undefined);

      const port = Number.parseInt(form.port, 10);
      const payload = {
        name: form.name.trim(),
        hostname: form.hostname.trim(),
        port: Number.isFinite(port) && port > 0 ? port : SSH_DEFAULT_PORT,
        username: form.username.trim(),
        authMethod: form.authMethod,
        password: keep(sealed.password, source?.password),
        privateKey: keep(sealed.privateKey, source?.privateKey),
        passphrase: keep(sealed.passphrase, source?.passphrase),
        keyName: source?.keyName,
        proxyJump: form.proxyJump.trim() || undefined,
        forwardAgent: form.forwardAgent,
        note: form.note.trim() || undefined,
        // A clone is a fresh, user-created host; its host-key fingerprint is
        // re-learned on first connect (a different IP has a different key).
        source: editing?.source ?? ("manual" as const),
        fingerprint: editing?.fingerprint,
        extraOptions: source?.extraOptions,
      };

      if (editing) await edit(editing.id, payload);
      else await add(payload);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const method = form.authMethod;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? t("ssh_edit_title")
              : cloning
                ? t("ssh_clone_title")
                : t("ssh_create_title")}
          </DialogTitle>
          <DialogDescription>
            {cloning ? t("ssh_clone_desc") : t("ssh_dialog_desc")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="ssh-name">{t("ssh_name_label")}</Label>
            <Input
              id="ssh-name"
              placeholder="prod-web-01"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-[1fr_110px] gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ssh-host">{t("ssh_hostname_label")}</Label>
              <Input
                id="ssh-host"
                placeholder="10.0.0.1 / example.com"
                value={form.hostname}
                onChange={(e) =>
                  setForm({ ...form, hostname: e.target.value })
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ssh-port">{t("ssh_port_label")}</Label>
              <Input
                id="ssh-port"
                inputMode="numeric"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: e.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ssh-user">{t("ssh_username_label")}</Label>
            <Input
              id="ssh-user"
              placeholder="root"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>{t("ssh_auth_method_label")}</Label>
            <Select
              value={form.authMethod}
              onValueChange={(v) =>
                setForm({ ...form, authMethod: v as SshAuthMethod })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SSH_AUTH_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {t(m.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {method === "password" && (
            <div className="grid gap-1.5">
              <Label htmlFor="ssh-pass">
                {t("ssh_password_label")}
                {secretKept}
              </Label>
              <PasswordInput
                id="ssh-pass"
                value={form.password}
                onChange={(e) =>
                  setForm({ ...form, password: e.target.value })
                }
              />
            </div>
          )}

          {method === "key" && (
            <>
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="ssh-key">
                    {t("ssh_private_key_label")}
                    {secretKept}
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onPickKeyFile}
                  >
                    {t("ssh_private_key_upload")}
                  </Button>
                  <input
                    ref={fileInput}
                    type="file"
                    className="hidden"
                    onChange={onKeyFile}
                  />
                </div>
                <Textarea
                  id="ssh-key"
                  className="font-mono text-label-12"
                  rows={5}
                  placeholder={t("ssh_private_key_placeholder")}
                  value={form.privateKey}
                  onChange={(e) =>
                    setForm({ ...form, privateKey: e.target.value })
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ssh-kp">
                  {t("ssh_passphrase_label")}
                  {secretKept}
                </Label>
                <PasswordInput
                  id="ssh-kp"
                  value={form.passphrase}
                  onChange={(e) =>
                    setForm({ ...form, passphrase: e.target.value })
                  }
                />
              </div>
            </>
          )}

          {method === "agent" && (
            <p className="rounded-sm border border-border bg-background-secondary px-3 py-2.5 text-label-12 text-muted-foreground">
              {t("ssh_agent_hint")}
            </p>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="ssh-jump">{t("ssh_proxy_jump_label")}</Label>
            <Input
              id="ssh-jump"
              placeholder="bastion"
              value={form.proxyJump}
              onChange={(e) => setForm({ ...form, proxyJump: e.target.value })}
            />
          </div>

          <div className="flex items-center justify-between rounded-sm border border-border px-3 py-2.5">
            <Label>{t("ssh_forward_agent_label")}</Label>
            <Switch
              checked={form.forwardAgent}
              onCheckedChange={(v) => setForm({ ...form, forwardAgent: v })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ssh-note">{t("ssh_note_label")}</Label>
            <Input
              id="ssh-note"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </div>

          {error && <p className="text-label-13 text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("cancel", { ns: "common" })}
          </Button>
          <Button onClick={submit} disabled={busy}>
            {editing
              ? t("save", { ns: "common" })
              : t("create", { ns: "common" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
