import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { useSshHostStore } from "@/store";
import type { SshHost } from "@/types";
import {
  exportVault,
  importVault,
  openHostSecrets,
  sealHostSecrets,
} from "@/lib/ssh/client";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "export" | "import";
}

/** Shape stored inside a `.ltfvault` file: hosts with PLAINTEXT secrets. */
type VaultHost = Omit<SshHost, "id" | "createdAt" | "updatedAt">;

export function SshVaultDialog({ open, onOpenChange, mode }: Props) {
  const { t } = useTranslation("pages");
  const items = useSshHostStore((s) => s.items);
  const add = useSshHostStore((s) => s.add);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPassphrase("");
      setError(null);
      setDone(null);
    }
  }, [open]);

  const runExport = async () => {
    // Decrypt every host's secrets so the portable file is device-independent.
    const plain: VaultHost[] = [];
    for (const h of items) {
      const secrets = await openHostSecrets(h);
      const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = h;
      void _id;
      void _c;
      void _u;
      plain.push({ ...rest, ...secrets });
    }
    const ok = await exportVault(JSON.stringify(plain), passphrase);
    if (ok) setDone(t("ssh_vault_exported"));
  };

  const runImport = async () => {
    const json = await importVault(passphrase);
    if (json === null) return; // cancelled
    const hosts = JSON.parse(json) as VaultHost[];
    let count = 0;
    for (const h of hosts) {
      // Re-seal secrets for storage: portable (`enc:v2:`) when a sync passphrase
      // is set, otherwise device-local (`enc:v1:`).
      const sealed = await sealHostSecrets({
        password: h.password,
        privateKey: h.privateKey,
        passphrase: h.passphrase,
      });
      await add({ ...h, ...sealed });
      count += 1;
    }
    setDone(t("ssh_vault_imported", { count }));
  };

  const submit = async () => {
    if (!passphrase.trim()) return setError(t("ssh_vault_passphrase_required"));
    setBusy(true);
    setError(null);
    try {
      if (mode === "export") await runExport();
      else await runImport();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const isExport = mode === "export";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isExport
              ? t("ssh_vault_export_title")
              : t("ssh_vault_import_title")}
          </DialogTitle>
          <DialogDescription>
            {isExport
              ? t("ssh_vault_export_desc")
              : t("ssh_vault_import_desc")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="ssh-vault-pass">
              {t("ssh_vault_passphrase_label")}
            </Label>
            <PasswordInput
              id="ssh-vault-pass"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            <p className="text-label-12 text-muted-foreground">
              {t("ssh_vault_passphrase_hint")}
            </p>
          </div>

          {done && <p className="text-label-13 text-success">{done}</p>}
          {error && <p className="text-label-13 text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("close", { ns: "common" })}
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {isExport
              ? t("ssh_vault_export_action")
              : t("ssh_vault_import_action")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
