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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAgentDefStore, useSkillStore, useMcpStore, useBuiltinMcpStore } from "@/store";
import { builtinServers } from "@/store/builtinMcp";
import { useUnifiedStore } from "@/store/unified";
import {
  AGENT_INTERNAL_TOOL_IDS,
  type AgentDefinition,
  type AgentInternalToolId,
  type AgentSandboxMode,
} from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: AgentDefinition | null;
}

interface FormState {
  name: string;
  description: string;
  systemPrompt: string;
  modelId: string;
  enabledInternalTools: AgentInternalToolId[];
  enabledSkillIds: string[];
  enabledMcpServerIds: string[];
  sandboxMode: AgentSandboxMode;
  temperature: string;
  maxTokens: string;
}

const EMPTY: FormState = {
  name: "",
  description: "",
  systemPrompt: "",
  modelId: "",
  enabledInternalTools: [],
  enabledSkillIds: [],
  enabledMcpServerIds: [],
  sandboxMode: "read-only",
  temperature: "0.7",
  maxTokens: "4096",
};

const SANDBOX_MODES: { value: AgentSandboxMode; label: string }[] = [
  { value: "read-only", label: "Read only" },
  { value: "workspace-write", label: "Execution write" },
  { value: "danger-full-access", label: "Full access" },
];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

export function AgentDefDialog({ open, onOpenChange, editing }: Props) {
  const { t } = useTranslation("pages");
  const add = useAgentDefStore((s) => s.add);
  const edit = useAgentDefStore((s) => s.edit);
  const skills = useSkillStore((s) => s.items);
  const userMcpServers = useMcpStore((s) => s.items);
  const builtinStates = useBuiltinMcpStore((s) => s.states);
  const mcpServers = [
    ...userMcpServers,
    ...builtinServers(builtinStates).filter((s) => s.installed),
  ];
  const unifiedModels = useUnifiedStore((s) => s.models);
  const unifiedConfig = useUnifiedStore((s) => s.config);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      editing
        ? {
            name: editing.name,
            description: editing.description,
            systemPrompt: editing.systemPrompt,
            modelId: editing.modelId,
            enabledInternalTools: [...editing.enabledInternalTools],
            enabledSkillIds: [...editing.enabledSkillIds],
            enabledMcpServerIds: [...editing.enabledMcpServerIds],
            sandboxMode: editing.sandboxMode,
            temperature: String(editing.temperature),
            maxTokens: String(editing.maxTokens),
          }
        : EMPTY
    );
  }, [open, editing]);

  const disabledModelIds = new Set(unifiedConfig.disabledModelIds);
  const availableModels = unifiedModels.filter(
    (m) => !disabledModelIds.has(m.id)
  );

  const submit = async () => {
    if (!form.name.trim()) return setError(t("agents_name_required"));
    if (!form.modelId) return setError(t("agents_model_required"));

    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      systemPrompt: form.systemPrompt,
      modelId: form.modelId,
      enabledInternalTools: form.enabledInternalTools,
      enabledSkillIds: form.enabledSkillIds,
      enabledMcpServerIds: form.enabledMcpServerIds,
      sandboxMode: form.sandboxMode,
      workspacePath: "",
      temperature: Number(form.temperature) || 0,
      maxTokens: Number(form.maxTokens) || 4096,
    };

    if (editing) await edit(editing.id, payload);
    else await add(payload);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing ? t("agents_edit_title") : t("agents_create_title")}
          </DialogTitle>
          <DialogDescription>{t("agents_dialog_desc")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="agent-name">{t("name", { ns: "common" })}</Label>
            <Input
              id="agent-name"
              placeholder="Coding Agent"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="agent-desc">{t("agents_description_label")}</Label>
            <Input
              id="agent-desc"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="agent-prompt">
              {t("agents_system_prompt_label")}
            </Label>
            <Textarea
              id="agent-prompt"
              rows={4}
              placeholder={t("agents_system_prompt_placeholder")}
              value={form.systemPrompt}
              onChange={(e) =>
                setForm({ ...form, systemPrompt: e.target.value })
              }
            />
          </div>

          <div className="grid gap-1.5">
            <Label>{t("agents_model_label")}</Label>
            <Select
              value={form.modelId}
              onValueChange={(v) => setForm({ ...form, modelId: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("agents_model_placeholder")} />
              </SelectTrigger>
              <SelectContent>
                {availableModels.length === 0 ? (
                  <div className="px-2 py-1.5 text-label-12 text-muted-foreground">
                    {t("agents_no_models")}
                  </div>
                ) : (
                  availableModels.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.id}
                      {m.features.includes("function-call") ? "" : " ⚠︎"}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <p className="text-label-12 text-muted-foreground">
              {t("agents_model_hint")}
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label>{t("agents_internal_tools_label")}</Label>
            <div className="flex flex-wrap gap-1.5">
              {AGENT_INTERNAL_TOOL_IDS.map((id) => {
                const active = form.enabledInternalTools.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        enabledInternalTools: toggle(
                          form.enabledInternalTools,
                          id
                        ),
                      })
                    }
                    className={cn(
                      "rounded-sm border px-2.5 py-1 text-label-13 transition-colors",
                      active
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:bg-muted/60"
                    )}
                  >
                    {id}
                  </button>
                );
              })}
            </div>
            <p className="text-label-12 text-muted-foreground">
              {t("agents_internal_tools_hint")}
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label>{t("agents_sandbox_label")}</Label>
            <Select
              value={form.sandboxMode}
              onValueChange={(v) =>
                setForm({ ...form, sandboxMode: v as AgentSandboxMode })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SANDBOX_MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {skills.length > 0 && (
            <div className="grid gap-1.5">
              <Label>{t("agents_skills_label")}</Label>
              <div className="flex flex-wrap gap-1.5">
                {skills.map((s) => {
                  const active = form.enabledSkillIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          enabledSkillIds: toggle(form.enabledSkillIds, s.id),
                        })
                      }
                      className={cn(
                        "rounded-sm border px-2.5 py-1 text-label-13 transition-colors",
                        active
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:bg-muted/60"
                      )}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {mcpServers.length > 0 && (
            <div className="grid gap-1.5">
              <Label>{t("agents_mcp_label")}</Label>
              <div className="flex flex-wrap gap-1.5">
                {mcpServers.map((s) => {
                  const active = form.enabledMcpServerIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          enabledMcpServerIds: toggle(
                            form.enabledMcpServerIds,
                            s.id
                          ),
                        })
                      }
                      className={cn(
                        "flex items-center gap-1 rounded-sm border px-2.5 py-1 text-label-13 transition-colors",
                        active
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:bg-muted/60"
                      )}
                    >
                      {s.name}
                      {!s.enabled && (
                        <Badge variant="default" className="px-1 py-0">
                          off
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="agent-temp">
                {t("agents_temperature_label")}
              </Label>
              <Input
                id="agent-temp"
                type="number"
                step="0.1"
                value={form.temperature}
                onChange={(e) =>
                  setForm({ ...form, temperature: e.target.value })
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="agent-maxtok">
                {t("agents_max_tokens_label")}
              </Label>
              <Input
                id="agent-maxtok"
                type="number"
                value={form.maxTokens}
                onChange={(e) =>
                  setForm({ ...form, maxTokens: e.target.value })
                }
              />
            </div>
          </div>

          {error && <p className="text-label-13 text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("cancel", { ns: "common" })}
          </Button>
          <Button onClick={submit}>
            {editing
              ? t("save", { ns: "common" })
              : t("create", { ns: "common" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
