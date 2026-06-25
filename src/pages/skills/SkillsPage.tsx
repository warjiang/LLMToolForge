import { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  CheckCircle2,
  FolderKanban,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Reveal } from "@/components/common/Reveal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  globalTargetPayload,
  projectTargetPayload,
  skillPayload,
  syncSkillsToTargets,
  type SyncSkillResult,
} from "@/lib/skillSync";
import {
  getSkillTarget,
  selectedTargets,
  skillTargetName,
} from "@/lib/skillTargets";
import { useSkillProjectConfigStore, useSkillStore } from "@/store";
import type { Skill, SkillProjectConfig } from "@/types";
import { SkillDialog } from "./SkillDialog";
import { SkillProjectDialog } from "./SkillProjectDialog";

interface SyncState {
  title: string;
  results: SyncSkillResult[];
}

export function SkillsPage() {
  const { items, loaded, load, edit, remove } = useSkillStore();
  const projects = useSkillProjectConfigStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [editingProject, setEditingProject] =
    useState<SkillProjectConfig | null>(null);
  const [deleting, setDeleting] = useState<Skill | null>(null);
  const [deletingProject, setDeletingProject] =
    useState<SkillProjectConfig | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) load();
    if (!projects.loaded) projects.load();
  }, [loaded, load, projects]);

  const syncableSkills = useMemo(
    () =>
      items.filter(
        (skill) => skill.enabled && (skill.agentKeys ?? []).length > 0
      ),
    [items]
  );

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openProjectCreate = () => {
    setEditingProject(null);
    setProjectDialogOpen(true);
  };

  const syncGlobalSkill = async (skill: Skill): Promise<SyncSkillResult[]> => {
    const targets = selectedTargets(skill.agentKeys ?? []).map(globalTargetPayload);
    if (targets.length === 0) return [];
    return syncSkillsToTargets({
      mode: skill.syncMode ?? "copy",
      skills: [skillPayload(skill)],
      targets,
    });
  };

  const runGlobalSync = async (skill?: Skill) => {
    setSyncing(true);
    setSyncError(null);
    try {
      const targets = skill ? [skill] : syncableSkills;
      const results: SyncSkillResult[] = [];
      for (const item of targets) {
        results.push(...(await syncGlobalSkill(item)));
      }
      setSyncState({
        title: skill ? `${skill.name} 全局同步` : "全局同步",
        results,
      });
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "同步失败");
    } finally {
      setSyncing(false);
    }
  };

  const runProjectSync = async (project: SkillProjectConfig) => {
    setSyncing(true);
    setSyncError(null);
    try {
      const skills = items.filter(
        (skill) => skill.enabled && project.skillIds.includes(skill.id)
      );
      const targets = selectedTargets(project.agentKeys).map((target) =>
        projectTargetPayload(target, project.name, project.projectPath)
      );
      const results = await syncSkillsToTargets({
        mode: project.syncMode,
        skills: skills.map(skillPayload),
        targets,
      });
      setSyncState({ title: `${project.name} 项目同步`, results });
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "同步失败");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Skills"
        description="管理可复用技能，并同步到全局或项目级 Agent 目录。"
        actions={
          <>
            <Button variant="secondary" onClick={openProjectCreate}>
              <FolderKanban className="h-4 w-4" />
              新建项目
            </Button>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              新建 Skill
            </Button>
          </>
        }
      />

      <SyncResultPanel state={syncState} error={syncError} />

      <Tabs defaultValue="library">
        <TabsList>
          <TabsTrigger value="library">Skill 库</TabsTrigger>
          <TabsTrigger value="projects">项目配置</TabsTrigger>
        </TabsList>

        <TabsContent value="library">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{items.length} Skills</Badge>
              <Badge variant="outline">{syncableSkills.length} 已分配</Badge>
            </div>
            <Button
              variant="secondary"
              disabled={syncing || syncableSkills.length === 0}
              onClick={() => runGlobalSync()}
            >
              <UploadCloud className="h-4 w-4" />
              同步全局
            </Button>
          </div>

          {items.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title="还没有 Skill"
              description="创建第一个技能，描述它的用途并打上标签便于检索。"
              action={
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  新建 Skill
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {items.map((item, i) => (
                <Reveal key={item.id} index={i} className="flex">
                  <SkillCard
                    skill={item}
                    syncing={syncing}
                    onSync={() => runGlobalSync(item)}
                    onToggle={(enabled) => edit(item.id, { enabled })}
                    onEdit={() => {
                      setEditing(item);
                      setDialogOpen(true);
                    }}
                    onDelete={() => setDeleting(item)}
                  />
                </Reveal>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="projects">
          <div className="mb-4 flex items-center justify-between gap-3">
            <Badge variant="outline">{projects.items.length} 项目</Badge>
            <Button variant="secondary" onClick={openProjectCreate}>
              <FolderKanban className="h-4 w-4" />
              新建项目
            </Button>
          </div>

          {projects.items.length === 0 ? (
            <EmptyState
              icon={FolderKanban}
              title="还没有项目配置"
              description="为仓库配置项目级 Skill 目录。"
              action={
                <Button onClick={openProjectCreate}>
                  <Plus className="h-4 w-4" />
                  新建项目
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {projects.items.map((project, i) => (
                <Reveal key={project.id} index={i} className="flex">
                  <ProjectCard
                    project={project}
                    skills={items}
                    syncing={syncing}
                    onSync={() => runProjectSync(project)}
                    onToggle={(enabled) =>
                      projects.edit(project.id, { enabled })
                    }
                    onEdit={() => {
                      setEditingProject(project);
                      setProjectDialogOpen(true);
                    }}
                    onDelete={() => setDeletingProject(project)}
                  />
                </Reveal>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <SkillDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
      />
      <SkillProjectDialog
        open={projectDialogOpen}
        onOpenChange={setProjectDialogOpen}
        editing={editingProject}
        skills={items}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        description={`确定删除 “${deleting?.name}” 吗？此操作无法撤销。`}
        onConfirm={() => {
          if (deleting) remove(deleting.id);
          setDeleting(null);
        }}
      />
      <ConfirmDialog
        open={!!deletingProject}
        onOpenChange={(o) => !o && setDeletingProject(null)}
        description={`确定删除 “${deletingProject?.name}” 吗？此操作无法撤销。`}
        onConfirm={() => {
          if (deletingProject) projects.remove(deletingProject.id);
          setDeletingProject(null);
        }}
      />
    </div>
  );
}

function SkillCard({
  skill,
  syncing,
  onSync,
  onToggle,
  onEdit,
  onDelete,
}: {
  skill: Skill;
  syncing: boolean;
  onSync: () => void;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const targets = (skill.agentKeys ?? [])
    .map(getSkillTarget)
    .filter((target) => target !== null);

  return (
    <Card className="flex flex-1 flex-col p-5 transition-all duration-200 ease-geist hover:-translate-y-0.5 hover:shadow-geist-md">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
            <Boxes className="h-4 w-4" />
          </div>
          <span className="truncate text-label-14 font-medium">
            {skill.name}
          </span>
        </div>
        <RowMenu onEdit={onEdit} onDelete={onDelete} />
      </div>

      <p className="mt-3 line-clamp-2 min-h-[40px] text-copy-13 text-muted-foreground">
        {skill.description || "暂无描述"}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {targets.length === 0 ? (
          <Badge variant="outline">未分配 Agent</Badge>
        ) : (
          targets.map((target) => (
            <Badge
              key={target.key}
              variant={target.category === "lobster" ? "accent" : "outline"}
            >
              {target.name}
            </Badge>
          ))
        )}
      </div>

      {skill.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {skill.tags.map((tag) => (
            <Badge key={tag} variant="default">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
        <div className="flex items-center gap-2">
          <Switch checked={skill.enabled} onCheckedChange={onToggle} />
          <span className="text-label-12 text-muted-foreground">
            {skill.enabled ? "已启用" : "已禁用"}
          </span>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={syncing || !skill.enabled || targets.length === 0}
          onClick={onSync}
        >
          <RefreshCw className="h-4 w-4" />
          同步
        </Button>
      </div>
    </Card>
  );
}

function ProjectCard({
  project,
  skills,
  syncing,
  onSync,
  onToggle,
  onEdit,
  onDelete,
}: {
  project: SkillProjectConfig;
  skills: Skill[];
  syncing: boolean;
  onSync: () => void;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const selectedSkills = skills.filter((skill) =>
    project.skillIds.includes(skill.id)
  );
  const canSync =
    project.enabled &&
    project.projectPath.trim() &&
    project.agentKeys.length > 0 &&
    selectedSkills.some((skill) => skill.enabled);

  return (
    <Card className="flex flex-1 flex-col p-5 transition-all duration-200 ease-geist hover:-translate-y-0.5 hover:shadow-geist-md">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FolderKanban className="h-4 w-4 text-muted-foreground" />
            <span className="truncate text-label-14 font-medium">
              {project.name}
            </span>
          </div>
          <p className="mt-1 truncate text-label-12 text-muted-foreground">
            {project.projectPath}
          </p>
        </div>
        <RowMenu onEdit={onEdit} onDelete={onDelete} />
      </div>

      <div className="mt-4 grid gap-3">
        <div className="flex flex-wrap gap-1.5">
          {project.agentKeys.map((key) => (
            <Badge
              key={key}
              variant={
                getSkillTarget(key)?.category === "lobster"
                  ? "accent"
                  : "outline"
              }
            >
              {skillTargetName(key)}
            </Badge>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {selectedSkills.length === 0 ? (
            <Badge variant="outline">未选择 Skill</Badge>
          ) : (
            selectedSkills.map((skill) => (
              <Badge
                key={skill.id}
                variant={skill.enabled ? "default" : "warning"}
              >
                {skill.name}
              </Badge>
            ))
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
        <div className="flex items-center gap-2">
          <Switch checked={project.enabled} onCheckedChange={onToggle} />
          <span className="text-label-12 text-muted-foreground">
            {project.syncMode === "symlink" ? "软链" : "复制"}
          </span>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={syncing || !canSync}
          onClick={onSync}
        >
          <UploadCloud className="h-4 w-4" />
          同步
        </Button>
      </div>
    </Card>
  );
}

function SyncResultPanel({
  state,
  error,
}: {
  state: SyncState | null;
  error: string | null;
}) {
  if (!state && !error) return null;
  const ok = state?.results.filter((result) => result.status === "success") ?? [];
  const failed = state?.results.filter((result) => result.status === "error") ?? [];

  return (
    <div className="mb-5 rounded-md border border-border bg-secondary/45 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-label-13 font-medium">
          {error || failed.length > 0 ? (
            <XCircle className="h-4 w-4 text-destructive" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-success" />
          )}
          {error ? "同步失败" : state?.title}
        </div>
        {state && (
          <div className="flex gap-2">
            <Badge variant="success">{ok.length} 成功</Badge>
            {failed.length > 0 && (
              <Badge variant="destructive">{failed.length} 失败</Badge>
            )}
          </div>
        )}
      </div>
      {error && (
        <p className="mt-2 text-label-12 text-destructive">{error}</p>
      )}
      {failed.length > 0 && (
        <div className="mt-2 grid gap-1">
          {failed.slice(0, 4).map((result) => (
            <p
              key={`${result.skillId}:${result.agentKey}:${result.targetPath}`}
              className="truncate text-label-12 text-destructive"
              title={result.error}
            >
              {result.skillName} / {result.agentName}: {result.error}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function RowMenu({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="操作">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit}>
          <Pencil className="h-4 w-4" />
          编辑
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
          删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
