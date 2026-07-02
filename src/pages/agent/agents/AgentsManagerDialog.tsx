import { useEffect, useState } from "react";
import {
  Pencil,
  Plus,
  Trash2,
  Bot,
  Package,
  RefreshCw,
  Loader2,
  ArrowUpCircle,
  CheckCircle2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAgentDefStore } from "@/store";
import { useMarketSettingsStore } from "@/store/marketSettings";
import type { AgentDefinition } from "@/types";
import { checkAgentUpdate, type AgentUpdateState } from "@/lib/agentMarket";
import { AgentDefDialog } from "./AgentDefDialog";
import { ExternalAgentInstallDialog } from "./ExternalAgentInstallDialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface UpdateInfo {
  checking?: boolean;
  updating?: boolean;
  state?: AgentUpdateState;
  error?: string;
}

export function AgentsManagerDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation("pages");
  const { items, loaded, load, remove, edit } = useAgentDefStore();
  const githubToken = useMarketSettingsStore((s) => s.githubToken);
  const [editorOpen, setEditorOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [editing, setEditing] = useState<AgentDefinition | null>(null);
  const [deleting, setDeleting] = useState<AgentDefinition | null>(null);
  const [updates, setUpdates] = useState<Record<string, UpdateInfo>>({});

  useEffect(() => {
    if (open && !loaded) load();
  }, [open, loaded, load]);

  const setUpdate = (id: string, info: UpdateInfo) =>
    setUpdates((prev) => ({ ...prev, [id]: { ...prev[id], ...info } }));

  const checkUpdate = async (def: AgentDefinition) => {
    setUpdate(def.id, { checking: true, error: undefined, state: undefined });
    const token = githubToken.trim() || undefined;
    const res = await checkAgentUpdate(def, token);
    setUpdate(def.id, {
      checking: false,
      state: res.state,
      error: res.error,
    });
  };

  const applyUpdate = async (def: AgentDefinition) => {
    setUpdate(def.id, { updating: true, error: undefined });
    try {
      const token = githubToken.trim() || undefined;
      const res = await checkAgentUpdate(def, token);
      if (res.state === "error" || !res.resolved) {
        throw new Error(res.error || "Update check failed");
      }
      const resolved = res.resolved;
      const { invoke } = await import("@tauri-apps/api/core");
      const packageDir = await invoke<string>("agent_write_package", {
        id: resolved.manifest.id,
        files: resolved.files,
      });
      const taskId = `update-${resolved.manifest.id}-${Date.now()}`;
      const build = await invoke<{ ok: boolean; envPath: string }>(
        "agent_build_env",
        {
          taskId,
          spec: { runtime: def.external!.runtime, packageDir },
        }
      );
      if (!build.ok) throw new Error(t("agents_update_build_failed"));
      await edit(def.id, {
        external: {
          ...def.external!,
          packageDir,
          envPath: build.envPath,
          framework: resolved.manifest.framework ?? def.external!.framework,
          installedVersion:
            resolved.manifest.version ?? def.external!.installedVersion,
          sourceRef: resolved.ref,
          installedHash: resolved.hash,
        },
      });
      setUpdate(def.id, { updating: false, state: "up-to-date" });
    } catch (e) {
      setUpdate(def.id, {
        updating: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (def: AgentDefinition) => {
    setEditing(def);
    setEditorOpen(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("agents_manage_title")}</DialogTitle>
            <DialogDescription>{t("agents_manage_desc")}</DialogDescription>
          </DialogHeader>

          <div className="mb-3 flex flex-wrap gap-2">
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t("agents_new")}
            </Button>
            <Button variant="secondary" onClick={() => setInstallOpen(true)}>
              <Package className="h-4 w-4" />
              {t("agents_install_external")}
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            {items.length === 0 ? (
              <div className="rounded-sm border border-dashed border-border px-4 py-10 text-center text-label-13 text-muted-foreground">
                {t("agents_empty")}
              </div>
            ) : (
              items.map((def) => (
                <div
                  key={def.id}
                  className="flex items-start justify-between gap-3 rounded-sm border border-border px-3 py-2.5"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate text-label-13 font-medium">
                        {def.name}
                      </span>
                      {def.kind === "external" && (
                        <Badge variant="outline" className="shrink-0">
                          {def.external?.framework
                            ? `${t("agents_badge_external")} · ${def.external.framework}`
                            : t("agents_badge_external")}
                          {def.external?.installedVersion
                            ? ` · v${def.external.installedVersion}`
                            : ""}
                        </Badge>
                      )}
                      {def.modelId && (
                        <Badge variant="default" className="shrink-0">
                          {def.modelId}
                        </Badge>
                      )}
                    </div>
                    {def.description && (
                      <p className="truncate text-label-12 text-muted-foreground">
                        {def.description}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {def.enabledInternalTools.map((id) => (
                        <Badge key={id} variant="outline" className="px-1 py-0">
                          {id}
                        </Badge>
                      ))}
                      {def.enabledSkillIds.length > 0 && (
                        <Badge variant="outline" className="px-1 py-0">
                          {t("agents_badge_skills", {
                            count: def.enabledSkillIds.length,
                          })}
                        </Badge>
                      )}
                      {def.enabledMcpServerIds.length > 0 && (
                        <Badge variant="outline" className="px-1 py-0">
                          {t("agents_badge_mcp", {
                            count: def.enabledMcpServerIds.length,
                          })}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {def.kind === "external" && def.external?.source && (
                      <UpdateControls
                        info={updates[def.id]}
                        onCheck={() => checkUpdate(def)}
                        onUpdate={() => applyUpdate(def)}
                        labels={{
                          check: t("agents_update_check"),
                          update: t("agents_update_apply"),
                          available: t("agents_update_available"),
                          upToDate: t("agents_update_uptodate"),
                        }}
                      />
                    )}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      title={t("edit", { ns: "common" })}
                      onClick={() => openEdit(def)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="hover:bg-destructive/10 hover:text-destructive"
                      title={t("delete", { ns: "common" })}
                      onClick={() => setDeleting(def)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AgentDefDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editing={editing}
      />

      <ExternalAgentInstallDialog
        open={installOpen}
        onOpenChange={setInstallOpen}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title={t("agents_delete_title")}
        description={t("agents_delete_confirm", { name: deleting?.name ?? "" })}
        confirmLabel={t("delete", { ns: "common" })}
        onConfirm={() => {
          if (deleting) void remove(deleting.id);
          setDeleting(null);
        }}
      />
    </>
  );
}

interface UpdateControlsProps {
  info?: UpdateInfo;
  onCheck: () => void;
  onUpdate: () => void;
  labels: {
    check: string;
    update: string;
    available: string;
    upToDate: string;
  };
}

function UpdateControls({
  info,
  onCheck,
  onUpdate,
  labels,
}: UpdateControlsProps) {
  const busy = info?.checking || info?.updating;

  if (info?.state === "update-available" && !busy) {
    return (
      <Button
        size="icon-sm"
        variant="ghost"
        className="text-primary hover:text-primary"
        title={`${labels.available} — ${labels.update}`}
        onClick={onUpdate}
      >
        <ArrowUpCircle className="h-3.5 w-3.5" />
      </Button>
    );
  }

  if (info?.state === "up-to-date" && !busy) {
    return (
      <Button
        size="icon-sm"
        variant="ghost"
        className="text-success hover:text-success"
        title={labels.upToDate}
        onClick={onCheck}
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
      </Button>
    );
  }

  return (
    <Button
      size="icon-sm"
      variant="ghost"
      title={info?.error ?? labels.check}
      disabled={busy}
      onClick={onCheck}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <RefreshCw
          className={`h-3.5 w-3.5 ${info?.error ? "text-destructive" : ""}`}
        />
      )}
    </Button>
  );
}
