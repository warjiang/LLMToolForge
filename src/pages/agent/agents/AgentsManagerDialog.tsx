import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, Bot, Package } from "lucide-react";
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
import type { AgentDefinition } from "@/types";
import { AgentDefDialog } from "./AgentDefDialog";
import { ExternalAgentInstallDialog } from "./ExternalAgentInstallDialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AgentsManagerDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation("pages");
  const { items, loaded, load, remove } = useAgentDefStore();
  const [editorOpen, setEditorOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [editing, setEditing] = useState<AgentDefinition | null>(null);
  const [deleting, setDeleting] = useState<AgentDefinition | null>(null);

  useEffect(() => {
    if (open && !loaded) load();
  }, [open, loaded, load]);

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
