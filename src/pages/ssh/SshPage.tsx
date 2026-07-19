import { useEffect, useState } from "react";
import {
  Copy,
  FileDown,
  FileUp,
  KeyRound,
  MoreHorizontal,
  Pencil,
  Plug,
  Plus,
  Server,
  ServerCog,
  TerminalSquare,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Reveal } from "@/components/common/Reveal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSshHostStore, useSshSessionStore } from "@/store";
import { useSyncStore } from "@/store/sync";
import { migrateHostSecretsForSync, isDeviceLocalSeal } from "@/lib/ssh/client";
import { isTauri } from "@/lib/utils";
import type { SshAuthMethod, SshHost } from "@/types";
import { SshHostDialog } from "./SshHostDialog";
import { SshImportDialog } from "./SshImportDialog";
import { SshVaultDialog } from "./SshVaultDialog";

const AUTH_ICON: Record<SshAuthMethod, typeof KeyRound> = {
  password: UserRound,
  key: KeyRound,
  agent: ServerCog,
};

export function SshPage() {
  const { t } = useTranslation("pages");
  const { items, loaded, load, remove } = useSshHostStore();
  const edit = useSshHostStore((s) => s.edit);
  const syncConfigured = useSyncStore((s) => s.isConfigured());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [vaultMode, setVaultMode] = useState<"export" | "import" | null>(null);
  const [editing, setEditing] = useState<SshHost | null>(null);
  const [cloning, setCloning] = useState<SshHost | null>(null);
  const [deleting, setDeleting] = useState<SshHost | null>(null);
  const openSession = useSshSessionStore((s) => s.openTab);
  const desktop = isTauri();

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  // Migrate legacy device-local (`enc:v1:`) credentials to portable `enc:v2:`
  // envelopes once sync is configured, so synced devices can open them. Runs on
  // the origin device (whose keychain can still open v1); failures are skipped.
  useEffect(() => {
    if (!loaded || !syncConfigured || !isTauri()) return;
    const stale = items.filter(
      (h) =>
        isDeviceLocalSeal(h.password) ||
        isDeviceLocalSeal(h.privateKey) ||
        isDeviceLocalSeal(h.passphrase)
    );
    if (stale.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const host of stale) {
        if (cancelled) return;
        try {
          const patch = await migrateHostSecretsForSync(host);
          if (patch && !cancelled) await edit(host.id, patch);
        } catch {
          // Can't open this host's v1 blob on this device — leave it untouched.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loaded, syncConfigured, items, edit]);

  const passwordCount = items.filter((i) => i.authMethod === "password").length;
  const keyCount = items.filter((i) => i.authMethod === "key").length;
  const agentCount = items.filter((i) => i.authMethod === "agent").length;

  const openCreate = () => {
    setEditing(null);
    setCloning(null);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <section className="relative min-w-0 overflow-hidden rounded-lg border border-border bg-card p-5 shadow-geist-sm">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_12%,rgba(40,169,72,0.16),transparent_34%),linear-gradient(135deg,rgba(23,23,23,0.04),transparent_42%)]" />
        <div className="pointer-events-none absolute right-0 top-0 h-28 w-28 translate-x-8 -translate-y-10 rounded-full border border-border bg-background-secondary" />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl space-y-4">
            <Badge variant="accent" className="rounded-sm uppercase tracking-[0.08em]">
              {t("ssh_page_kicker")}
            </Badge>
            <div className="space-y-2">
              <h1 className="text-heading-32 text-foreground">
                {t("ssh_page_title")}
              </h1>
              <p className="max-w-[62ch] text-copy-14 text-muted-foreground">
                {t("ssh_page_desc")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={openCreate} aria-label={t("ssh_new_host")}>
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">{t("ssh_new_host")}</span>
              </Button>
              <Button
                variant="secondary"
                onClick={() => setImportOpen(true)}
                aria-label={t("ssh_import_config")}
              >
                <Upload className="h-4 w-4" />
                <span className="hidden sm:inline">{t("ssh_import_config")}</span>
              </Button>
              <Button
                variant="secondary"
                onClick={() => setVaultMode("export")}
                aria-label={t("ssh_export_vault")}
              >
                <FileDown className="h-4 w-4" />
                <span className="hidden sm:inline">{t("ssh_export_vault")}</span>
              </Button>
              <Button
                variant="secondary"
                onClick={() => setVaultMode("import")}
                aria-label={t("ssh_import_vault")}
              >
                <FileUp className="h-4 w-4" />
                <span className="hidden sm:inline">{t("ssh_import_vault")}</span>
              </Button>
            </div>
          </div>

          <div className="hidden min-w-full grid-cols-2 gap-2 sm:grid sm:grid-cols-4 xl:min-w-[480px]">
            <Metric icon={Server} label={t("ssh_total_hosts")} value={items.length} />
            <Metric
              icon={UserRound}
              label={t("ssh_password_hosts")}
              value={passwordCount}
            />
            <Metric icon={KeyRound} label={t("ssh_key_hosts")} value={keyCount} />
            <Metric
              icon={ServerCog}
              label={t("ssh_agent_hosts")}
              value={agentCount}
            />
          </div>
        </div>
      </section>

      {!desktop && (
        <p className="rounded-sm border border-border bg-background-secondary px-4 py-3 text-label-13 text-muted-foreground">
          {t("ssh_desktop_only")}
        </p>
      )}

      {!loaded ? (
        <SshSkeleton />
      ) : items.length === 0 ? (
        <SshEmptyPanel
          onCreate={openCreate}
          onImport={() => setImportOpen(true)}
        />
      ) : (
        <div className="grid min-w-0 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {items.map((item, i) => {
            const AuthIcon = AUTH_ICON[item.authMethod];
            return (
              <Reveal key={item.id} index={i} className="h-full min-w-0">
                <article className="group flex h-full min-h-[200px] min-w-0 flex-col justify-between rounded-md border border-border bg-card p-4 shadow-geist-sm transition-[transform,box-shadow,border-color] duration-200 ease-geist hover:-translate-y-0.5 hover:shadow-geist-md">
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-background-secondary text-foreground shadow-[inset_0_0_0_1px_var(--border)]">
                          <AuthIcon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <h2 className="truncate text-heading-16 text-foreground">
                              {item.name}
                            </h2>
                            <Badge variant="outline" className="rounded-sm uppercase">
                              {t(`ssh_auth_${item.authMethod}`)}
                            </Badge>
                          </div>
                          <p className="mt-1 flex items-center gap-1.5 text-label-12 text-muted-foreground">
                            <span className="h-1.5 w-1.5 rounded-full bg-success" />
                            {t("ssh_status_managed")}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-sm border border-border bg-background-secondary p-3">
                      <code className="block break-all text-label-12 font-mono leading-relaxed text-foreground">
                        {item.username}@{item.hostname}:{item.port}
                      </code>
                      {item.keyName && (
                        <p className="mt-1.5 flex items-center gap-1.5 truncate text-label-12 text-muted-foreground">
                          <KeyRound className="h-3 w-3 shrink-0" />
                          {t("ssh_managed_key")}: {item.keyName}
                        </p>
                      )}
                      {item.fingerprint && (
                        <p className="mt-1 truncate text-label-12 text-muted-foreground">
                          {t("ssh_fingerprint")}: {item.fingerprint}
                        </p>
                      )}
                    </div>

                    {item.note && (
                      <p className="line-clamp-2 text-copy-13 text-muted-foreground">
                        {item.note}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
                    <Button
                      size="sm"
                      onClick={() => openSession(item)}
                      disabled={!desktop}
                      aria-label={t("ssh_connect")}
                    >
                      <Plug className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{t("ssh_connect")}</span>
                    </Button>
                    <RowMenu
                      onEdit={() => {
                        setCloning(null);
                        setEditing(item);
                        setDialogOpen(true);
                      }}
                      onClone={() => {
                        setEditing(null);
                        setCloning(item);
                        setDialogOpen(true);
                      }}
                      onDelete={() => setDeleting(item)}
                    />
                  </div>
                </article>
              </Reveal>
            );
          })}
        </div>
      )}

      <SshHostDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        cloneFrom={cloning}
      />
      <SshImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <SshVaultDialog
        open={vaultMode !== null}
        onOpenChange={(o) => !o && setVaultMode(null)}
        mode={vaultMode ?? "export"}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        description={t("confirm_delete_named", {
          ns: "common",
          name: deleting?.name ?? "",
        })}
        onConfirm={() => {
          if (deleting) remove(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Server;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-sm border border-border bg-background p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-label-12 font-medium text-muted-foreground">
          {label}
        </span>
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="font-mono text-heading-24 tabular-nums text-foreground">
        {value}
      </div>
    </div>
  );
}

function SshEmptyPanel({
  onCreate,
  onImport,
}: {
  onCreate: () => void;
  onImport: () => void;
}) {
  const { t } = useTranslation("pages");
  return (
    <section className="grid overflow-hidden rounded-lg border border-border bg-card shadow-geist-sm lg:grid-cols-[1fr_360px]">
      <div className="space-y-5 p-6">
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-background-secondary text-foreground shadow-[inset_0_0_0_1px_var(--border)]">
          <TerminalSquare className="h-5 w-5" />
        </div>
        <div className="max-w-xl space-y-2">
          <h2 className="text-heading-24 text-foreground">
            {t("ssh_empty_title")}
          </h2>
          <p className="text-copy-14 text-muted-foreground">
            {t("ssh_empty_desc")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onCreate} aria-label={t("ssh_new_host")}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{t("ssh_new_host")}</span>
          </Button>
          <Button
            variant="secondary"
            onClick={onImport}
            aria-label={t("ssh_import_config")}
          >
            <Upload className="h-4 w-4" />
            <span className="hidden sm:inline">{t("ssh_import_config")}</span>
          </Button>
        </div>
      </div>
      <div className="hidden border-t border-border bg-background-secondary p-5 sm:block lg:border-l lg:border-t-0">
        <div className="rounded-md border border-border bg-background p-4 font-mono text-label-12 leading-relaxed text-muted-foreground">
          <div className="text-foreground">{`Host prod-web`}</div>
          <div className="pl-4">{`HostName 10.0.0.1`}</div>
          <div className="pl-4">{`User root`}</div>
          <div className="pl-4">{`IdentityFile ~/.ssh/id_ed25519`}</div>
        </div>
        <p className="mt-3 text-copy-13 text-muted-foreground">
          {t("ssh_import_desc")}
        </p>
      </div>
    </section>
  );
}

function SshSkeleton() {
  return (
    <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="h-[200px] animate-pulse rounded-md border border-border bg-card p-4"
        >
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-md bg-secondary" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/2 rounded-sm bg-secondary" />
              <div className="h-3 w-1/3 rounded-sm bg-secondary" />
            </div>
          </div>
          <div className="mt-6 h-14 rounded-sm bg-secondary" />
          <div className="mt-4 h-9 rounded-sm bg-secondary" />
        </div>
      ))}
    </div>
  );
}

function RowMenu({
  onEdit,
  onClone,
  onDelete,
}: {
  onEdit: () => void;
  onClone: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("pages");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("actions", { ns: "common" })}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit}>
          <Pencil className="h-4 w-4" />
          {t("edit", { ns: "common" })}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onClone}>
          <Copy className="h-4 w-4" />
          {t("ssh_duplicate")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
          {t("delete", { ns: "common" })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
