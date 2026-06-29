import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, Loader2 } from "lucide-react";
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
import { useSshHostStore } from "@/store";
import {
  parseSshConfig,
  sealHostSecrets,
  type SshConfigCandidate,
} from "@/lib/ssh/client";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SshImportDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation("pages");
  const add = useSshHostStore((s) => s.add);
  const [path, setPath] = useState("");
  const [candidates, setCandidates] = useState<SshConfigCandidate[] | null>(
    null
  );
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPath("");
    setCandidates(null);
    setSelected(new Set());
    setError(null);
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const scan = async () => {
    setScanning(true);
    setError(null);
    try {
      const found = await parseSshConfig(path.trim() || undefined);
      setCandidates(found);
      setSelected(new Set(found.map((_, i) => i)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCandidates([]);
    } finally {
      setScanning(false);
    }
  };

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const importSelected = async () => {
    if (!candidates) return;
    setImporting(true);
    setError(null);
    try {
      for (let i = 0; i < candidates.length; i += 1) {
        if (!selected.has(i)) continue;
        const c = candidates[i];
        const sealed = await sealHostSecrets({
          privateKey: c.privateKey || undefined,
        });
        await add({
          name: c.name,
          hostname: c.hostname,
          port: c.port,
          username: c.username,
          authMethod: c.privateKey ? "key" : "agent",
          privateKey: sealed.privateKey,
          keyName: c.keyName,
          proxyJump: c.proxyJump,
          forwardAgent: c.forwardAgent,
          extraOptions: c.extraOptions,
          source: "ssh_config",
        });
      }
      handleOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("ssh_import_title")}</DialogTitle>
          <DialogDescription>{t("ssh_import_desc")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="ssh-cfg-path">{t("ssh_import_path_label")}</Label>
            <div className="flex gap-2">
              <Input
                id="ssh-cfg-path"
                placeholder="~/.ssh/config"
                value={path}
                onChange={(e) => setPath(e.target.value)}
              />
              <Button onClick={scan} disabled={scanning}>
                {scanning && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("ssh_import_scan")}
              </Button>
            </div>
          </div>

          {candidates && candidates.length === 0 && (
            <p className="rounded-sm border border-border bg-background-secondary px-3 py-2.5 text-label-13 text-muted-foreground">
              {t("ssh_import_none")}
            </p>
          )}

          {candidates && candidates.length > 0 && (
            <div className="max-h-[320px] space-y-1.5 overflow-y-auto rounded-sm border border-border p-1.5">
              {candidates.map((c, i) => (
                <label
                  key={`${c.name}-${i}`}
                  className="flex cursor-pointer items-start gap-3 rounded-sm px-2.5 py-2 hover:bg-background-secondary"
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-[var(--accent)]"
                    checked={selected.has(i)}
                    onChange={() => toggle(i)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-label-14 font-medium text-foreground">
                        {c.name}
                      </span>
                      {c.privateKey && (
                        <Badge
                          variant="accent"
                          className="rounded-sm gap-1 text-label-12"
                        >
                          <KeyRound className="h-3 w-3" />
                          {t("ssh_import_with_key")}
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-label-12 text-muted-foreground">
                      {c.username}@{c.hostname}:{c.port}
                      {c.keyName ? ` · ${c.keyName}` : ""}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          )}

          {error && <p className="text-label-13 text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <span className="mr-auto self-center text-label-12 text-muted-foreground">
            {candidates && candidates.length > 0
              ? t("ssh_import_selected_count", { count: selected.size })
              : ""}
          </span>
          <Button variant="secondary" onClick={() => handleOpenChange(false)}>
            {t("cancel", { ns: "common" })}
          </Button>
          <Button
            onClick={importSelected}
            disabled={importing || !candidates || selected.size === 0}
          >
            {importing && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("ssh_import_action")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
