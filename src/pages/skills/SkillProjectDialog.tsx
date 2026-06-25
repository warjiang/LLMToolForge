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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SKILL_SYNC_MODES, SKILL_TARGETS } from "@/lib/skillTargets";
import { useSkillProjectConfigStore } from "@/store";
import type {
  Skill,
  SkillAgentKey,
  SkillProjectConfig,
  SkillSyncMode,
} from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: SkillProjectConfig | null;
  skills: Skill[];
}

const empty = {
  name: "",
  projectPath: "",
  agentKeys: [] as SkillAgentKey[],
  skillIds: [] as string[],
  syncMode: "copy" as SkillSyncMode,
  enabled: true,
};

export function SkillProjectDialog({
  open,
  onOpenChange,
  editing,
  skills,
}: Props) {
  const add = useSkillProjectConfigStore((s) => s.add);
  const edit = useSkillProjectConfigStore((s) => s.edit);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      editing
        ? {
            name: editing.name,
            projectPath: editing.projectPath,
            agentKeys: editing.agentKeys,
            skillIds: editing.skillIds,
            syncMode: editing.syncMode,
            enabled: editing.enabled,
          }
        : empty
    );
  }, [open, editing]);

  const submit = async () => {
    if (!form.name.trim()) return setError("请填写项目名称");
    if (!form.projectPath.trim()) return setError("请填写项目路径");
    if (form.agentKeys.length === 0) return setError("请选择 Agent");
    if (form.skillIds.length === 0) return setError("请选择 Skill");

    const payload = {
      name: form.name.trim(),
      projectPath: form.projectPath.trim(),
      agentKeys: form.agentKeys,
      skillIds: form.skillIds,
      syncMode: form.syncMode,
      enabled: form.enabled,
    };

    if (editing) await edit(editing.id, payload);
    else await add(payload);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "编辑项目配置" : "新建项目配置"}</DialogTitle>
          <DialogDescription>配置项目路径、Agent 与 Skill 组合。</DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[68vh] gap-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="sp-name">名称</Label>
              <Input
                id="sp-name"
                placeholder="例如：LLMToolForge"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sp-path">项目路径</Label>
              <Input
                id="sp-path"
                placeholder="/path/to/project"
                value={form.projectPath}
                onChange={(e) =>
                  setForm({ ...form, projectPath: e.target.value })
                }
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Agent 目标</Label>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {SKILL_TARGETS.map((target) => {
                const selected = form.agentKeys.includes(target.key);
                return (
                  <Button
                    key={target.key}
                    type="button"
                    variant={selected ? "secondary" : "ghost"}
                    className="justify-start"
                    onClick={() =>
                      setForm({
                        ...form,
                        agentKeys: toggleKey(form.agentKeys, target.key),
                      })
                    }
                  >
                    <span
                      className={
                        selected
                          ? "h-1.5 w-1.5 rounded-full bg-accent"
                          : "h-1.5 w-1.5 rounded-full bg-muted"
                      }
                    />
                    {target.name}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Skills</Label>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {skills.map((skill) => {
                const selected = form.skillIds.includes(skill.id);
                return (
                  <Button
                    key={skill.id}
                    type="button"
                    variant={selected ? "secondary" : "ghost"}
                    className="h-auto justify-start py-2 text-left"
                    disabled={!skill.enabled}
                    onClick={() =>
                      setForm({
                        ...form,
                        skillIds: toggleString(form.skillIds, skill.id),
                      })
                    }
                  >
                    <span
                      className={
                        selected
                          ? "h-1.5 w-1.5 rounded-full bg-accent"
                          : "h-1.5 w-1.5 rounded-full bg-muted"
                      }
                    />
                    <span className="min-w-0 truncate">{skill.name}</span>
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>同步模式</Label>
              <Select
                value={form.syncMode}
                onValueChange={(syncMode) =>
                  setForm({ ...form, syncMode: syncMode as SkillSyncMode })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SKILL_SYNC_MODES.map((mode) => (
                    <SelectItem key={mode.value} value={mode.value}>
                      {mode.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-sm border border-border px-3 py-2.5">
              <Label>启用</Label>
              <Switch
                checked={form.enabled}
                onCheckedChange={(enabled) => setForm({ ...form, enabled })}
              />
            </div>
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

function toggleKey(keys: SkillAgentKey[], key: SkillAgentKey): SkillAgentKey[] {
  return keys.includes(key)
    ? keys.filter((item) => item !== key)
    : [...keys, key];
}

function toggleString(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}
