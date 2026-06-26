import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  FolderKanban,
  GitBranch,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Store,
  Tags,
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
import { SkillMarketDialog } from "./SkillMarketDialog";
import { SkillUpdatesDialog } from "./SkillUpdatesDialog";
import { SkillRequires } from "./SkillRequires";

interface SyncState {
  title: string;
  results: SyncSkillResult[];
}

type ProjectReadiness = {
  canSync: boolean;
  reason: string;
  selectedCount: number;
  enabledSelectedCount: number;
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function SkillsPage() {
  const { t } = useTranslation("pages");
  const { items, loaded, load, edit, remove } = useSkillStore();
  const projects = useSkillProjectConfigStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
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

  const assignedSkills = useMemo(
    () => items.filter((skill) => (skill.agentKeys ?? []).length > 0),
    [items]
  );

  const syncableSkills = useMemo(
    () => assignedSkills.filter((skill) => skill.enabled),
    [assignedSkills]
  );

  const marketSkillCount = useMemo(
    () => items.filter((s) => s.sourceType === "github" && s.source).length,
    [items]
  );

  const enabledProjectCount = useMemo(
    () => projects.items.filter((project) => project.enabled).length,
    [projects.items]
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
        title: skill
          ? t("skill_global_sync_title", { name: skill.name })
          : t("skill_global_sync_all"),
        results,
      });
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : t("skill_sync_failed"));
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
      setSyncState({
        title: t("skill_project_sync_title", { name: project.name }),
        results,
      });
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : t("skill_sync_failed"));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("skills_title")}
        description={t("skills_desc")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setMarketOpen(true)}>
              <Store className="h-4 w-4" />
              {t("skill_market_button")}
            </Button>
            <Button variant="secondary" onClick={openProjectCreate}>
              <FolderKanban className="h-4 w-4" />
              {t("skill_new_project")}
            </Button>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t("skill_new_skill")}
            </Button>
          </>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryMetric
          label={t("skill_metric_library")}
          value={items.length}
          detail={t("skill_metric_library_detail", {
            count: items.filter((skill) => skill.enabled).length,
          })}
        />
        <SummaryMetric
          label={t("skill_metric_assigned")}
          value={assignedSkills.length}
          detail={t("skill_metric_assigned_detail", {
            count: syncableSkills.length,
          })}
        />
        <SummaryMetric
          label={t("skill_metric_projects")}
          value={projects.items.length}
          detail={t("skill_metric_projects_detail", {
            count: enabledProjectCount,
          })}
        />
        <SummaryMetric
          label={t("skill_metric_market")}
          value={marketSkillCount}
          detail={t("skill_metric_market_detail")}
        />
      </section>

      <SyncResultPanel state={syncState} error={syncError} />

      <Tabs defaultValue="library">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <TabsList className="w-fit">
            <TabsTrigger value="library">{t("skill_library_tab")}</TabsTrigger>
            <TabsTrigger value="projects">{t("skill_projects_tab")}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="library">
          <SectionToolbar
            title={t("skill_library_heading")}
            description={t("skill_library_subtitle", {
              assigned: assignedSkills.length,
              total: items.length,
            })}
            badges={
              <>
                <Badge variant="outline">
                  {t("skill_total_count", { count: items.length })}
                </Badge>
                <Badge variant="outline">
                  {t("skill_assigned_count", { count: assignedSkills.length })}
                </Badge>
              </>
            }
            actions={
              <>
                <Button
                  variant="secondary"
                  disabled={marketSkillCount === 0}
                  onClick={() => setUpdatesOpen(true)}
                >
                  <RefreshCw className="h-4 w-4" />
                  {t("skill_updates_button")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={syncing || syncableSkills.length === 0}
                  onClick={() => runGlobalSync()}
                >
                  {syncing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UploadCloud className="h-4 w-4" />
                  )}
                  {t("skill_sync_global")}
                </Button>
              </>
            }
          />

          {items.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title={t("skill_empty_title")}
              description={t("skill_empty_desc")}
              action={
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  {t("skill_new_skill")}
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
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
          <SectionToolbar
            title={t("skill_projects_heading")}
            description={t("skill_projects_subtitle", {
              enabled: enabledProjectCount,
              total: projects.items.length,
            })}
            badges={
              <Badge variant="outline">
                {t("skill_project_count", { count: projects.items.length })}
              </Badge>
            }
            actions={
              <Button variant="secondary" onClick={openProjectCreate}>
                <FolderKanban className="h-4 w-4" />
                {t("skill_new_project")}
              </Button>
            }
          />

          {projects.items.length === 0 ? (
            <EmptyState
              icon={FolderKanban}
              title={t("skill_project_empty_title")}
              description={t("skill_project_empty_desc")}
              action={
                <Button onClick={openProjectCreate}>
                  <Plus className="h-4 w-4" />
                  {t("skill_new_project")}
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
      <SkillMarketDialog open={marketOpen} onOpenChange={setMarketOpen} />
      <SkillUpdatesDialog open={updatesOpen} onOpenChange={setUpdatesOpen} />
      <SkillProjectDialog
        open={projectDialogOpen}
        onOpenChange={setProjectDialogOpen}
        editing={editingProject}
        skills={items}
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
      <ConfirmDialog
        open={!!deletingProject}
        onOpenChange={(o) => !o && setDeletingProject(null)}
        description={t("confirm_delete_named", {
          ns: "common",
          name: deletingProject?.name ?? "",
        })}
        onConfirm={() => {
          if (deletingProject) projects.remove(deletingProject.id);
          setDeletingProject(null);
        }}
      />
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-border bg-background-secondary px-4 py-3 shadow-geist-sm">
      <div className="text-label-12 font-medium text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 font-mono text-heading-24 tabular-nums">
        {value}
      </div>
      <div className="mt-1 truncate text-label-12 text-muted-foreground">
        {detail}
      </div>
    </div>
  );
}

function SectionToolbar({
  title,
  description,
  badges,
  actions,
}: {
  title: string;
  description: string;
  badges?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-md border border-border bg-background-secondary px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-heading-16">{title}</h3>
          {badges}
        </div>
        <p className="mt-1 max-w-2xl text-copy-13 text-muted-foreground">
          {description}
        </p>
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
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
  const { t } = useTranslation("pages");
  const targets = (skill.agentKeys ?? [])
    .map(getSkillTarget)
    .filter((target) => target !== null);
  const canSync = skill.enabled && targets.length > 0;
  const syncReason = !skill.enabled
    ? t("skill_sync_blocked_disabled")
    : targets.length === 0
      ? t("skill_sync_blocked_unassigned")
      : t("skill_sync_ready", { count: targets.length });
  const tags = skill.tags ?? [];
  const visibleTags = tags.slice(0, 4);
  const hiddenTagCount = Math.max(0, tags.length - visibleTags.length);

  return (
    <Card className="group flex min-h-[260px] flex-1 flex-col overflow-hidden transition-[transform,box-shadow,border-color] duration-200 ease-geist hover:-translate-y-0.5 hover:border-muted-foreground/30 hover:shadow-geist-md">
      <div className="flex items-start justify-between gap-3 border-b border-border bg-background-secondary px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-card text-muted-foreground shadow-geist-sm">
            <Boxes className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h4 className="truncate text-heading-16">{skill.name}</h4>
              <Badge variant={skill.enabled ? "success" : "outline"}>
                {skill.enabled ? t("skill_enabled") : t("skill_disabled")}
              </Badge>
            </div>
            <p className="mt-1 line-clamp-2 text-copy-13 text-muted-foreground">
              {skill.description || t("skill_no_description")}
            </p>
          </div>
        </div>
        <RowMenu onEdit={onEdit} onDelete={onDelete} />
      </div>

      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="grid grid-cols-2 gap-2">
          <StatusCell
            label={t("skill_card_targets")}
            value={
              targets.length > 0
                ? t("skill_targets_count", { count: targets.length })
                : t("skill_unassigned_short")
            }
          />
          <StatusCell
            label={t("skill_card_sync_mode")}
            value={
              skill.syncMode === "symlink"
                ? t("skill_symlink_mode")
                : t("skill_copy_mode")
            }
          />
        </div>

        <div className="space-y-2">
          <LabelRow icon={<UploadCloud className="h-3.5 w-3.5" />}>
            {syncReason}
          </LabelRow>
          <div className="flex flex-wrap gap-1.5">
            {targets.length === 0 ? (
              <Badge variant="outline">{t("skill_unassigned")}</Badge>
            ) : (
              targets.map((target) => (
                <Badge
                  key={target.key}
                  variant={
                    target.category === "lobster" ? "accent" : "outline"
                  }
                >
                  {target.name}
                </Badge>
              ))
            )}
          </div>
        </div>

        <div className="space-y-2">
          <LabelRow icon={<Tags className="h-3.5 w-3.5" />}>
            {t("skill_card_metadata")}
          </LabelRow>
          <div className="flex flex-wrap gap-1.5">
            {skill.sourceType === "github" && (
              <Badge variant="outline" className="max-w-full">
                <GitBranch className="h-3 w-3" />
                <span className="truncate">{skill.source ?? "GitHub"}</span>
              </Badge>
            )}
            {(skill.files?.length ?? 0) > 1 && (
              <Badge variant="default">
                {t("skill_files_count", { count: skill.files!.length })}
              </Badge>
            )}
            {visibleTags.map((tag) => (
              <Badge key={tag} variant="default">
                {tag}
              </Badge>
            ))}
            {hiddenTagCount > 0 && (
              <Badge variant="outline">
                {t("skill_more_tags", { count: hiddenTagCount })}
              </Badge>
            )}
            {skill.sourceType !== "github" &&
              (skill.files?.length ?? 0) <= 1 &&
              tags.length === 0 && (
                <Badge variant="outline">{t("skill_no_metadata")}</Badge>
              )}
          </div>
        </div>

        {skill.requires?.bins?.length ? (
          <SkillRequires requires={skill.requires} />
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3">
          <div className="flex min-w-0 items-center gap-2">
            <Switch checked={skill.enabled} onCheckedChange={onToggle} />
            <span className="truncate text-label-12 text-muted-foreground">
              {skill.enabled ? t("skill_enabled") : t("skill_disabled")}
            </span>
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={syncing || !canSync}
            onClick={onSync}
          >
            {syncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t("skill_sync")}
          </Button>
        </div>
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
  const { t } = useTranslation("pages");
  const selectedSkills = skills.filter((skill) =>
    project.skillIds.includes(skill.id)
  );
  const readiness = getProjectReadiness(project, selectedSkills, t);

  return (
    <Card className="flex min-h-[260px] flex-1 flex-col overflow-hidden transition-[transform,box-shadow,border-color] duration-200 ease-geist hover:-translate-y-0.5 hover:border-muted-foreground/30 hover:shadow-geist-md">
      <div className="flex items-start justify-between gap-3 border-b border-border bg-background-secondary px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-card text-muted-foreground shadow-geist-sm">
            <FolderKanban className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h4 className="truncate text-heading-16">{project.name}</h4>
              <Badge variant={project.enabled ? "success" : "outline"}>
                {project.enabled ? t("skill_enabled") : t("skill_disabled")}
              </Badge>
            </div>
            <p
              className="mt-1 truncate font-mono text-label-12 text-muted-foreground"
              title={project.projectPath || t("skill_project_path_missing")}
            >
              {project.projectPath || t("skill_project_path_missing")}
            </p>
          </div>
        </div>
        <RowMenu onEdit={onEdit} onDelete={onDelete} />
      </div>

      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="grid grid-cols-2 gap-2">
          <StatusCell
            label={t("skill_project_agents")}
            value={t("skill_targets_count", { count: project.agentKeys.length })}
          />
          <StatusCell
            label={t("skill_project_selected")}
            value={t("skill_project_selected_count", {
              enabled: readiness.enabledSelectedCount,
              total: readiness.selectedCount,
            })}
          />
        </div>

        <div className="rounded-sm border border-border bg-background-secondary px-3 py-2">
          <div className="flex items-center gap-2">
            {readiness.canSync ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="text-label-13 font-medium">
              {readiness.reason}
            </span>
          </div>
          <p className="mt-1 text-label-12 text-muted-foreground">
            {project.syncMode === "symlink"
              ? t("skill_project_mode_symlink_hint")
              : t("skill_project_mode_copy_hint")}
          </p>
        </div>

        <div className="space-y-2">
          <LabelRow icon={<FolderKanban className="h-3.5 w-3.5" />}>
            {t("skill_agent_targets")}
          </LabelRow>
          <div className="flex flex-wrap gap-1.5">
            {project.agentKeys.length === 0 ? (
              <Badge variant="outline">{t("skill_project_no_agents")}</Badge>
            ) : (
              project.agentKeys.map((key) => (
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
              ))
            )}
          </div>
        </div>

        <div className="space-y-2">
          <LabelRow icon={<Boxes className="h-3.5 w-3.5" />}>
            {t("skill_project_skills")}
          </LabelRow>
          <div className="flex flex-wrap gap-1.5">
            {selectedSkills.length === 0 ? (
              <Badge variant="outline">{t("skill_unselected")}</Badge>
            ) : (
              selectedSkills.slice(0, 6).map((skill) => (
                <Badge
                  key={skill.id}
                  variant={skill.enabled ? "default" : "warning"}
                >
                  {skill.name}
                </Badge>
              ))
            )}
            {selectedSkills.length > 6 && (
              <Badge variant="outline">
                {t("skill_more_skills", { count: selectedSkills.length - 6 })}
              </Badge>
            )}
          </div>
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3">
          <div className="flex min-w-0 items-center gap-2">
            <Switch checked={project.enabled} onCheckedChange={onToggle} />
            <span className="truncate text-label-12 text-muted-foreground">
              {project.syncMode === "symlink"
                ? t("skill_symlink_mode")
                : t("skill_copy_mode")}
            </span>
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={syncing || !readiness.canSync}
            onClick={onSync}
          >
            {syncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UploadCloud className="h-4 w-4" />
            )}
            {t("skill_sync")}
          </Button>
        </div>
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
  const { t } = useTranslation("pages");
  if (!state && !error) return null;
  const ok = state?.results.filter((result) => result.status === "success") ?? [];
  const failed =
    state?.results.filter((result) => result.status === "error") ?? [];

  return (
    <section className="rounded-md border border-border bg-background-secondary p-4 shadow-geist-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-card shadow-geist-sm">
            {error || failed.length > 0 ? (
              <XCircle className="h-4 w-4 text-destructive" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-success" />
            )}
          </div>
          <div className="min-w-0">
            <h3 className="text-heading-16">
              {error ? t("skill_sync_failed") : state?.title}
            </h3>
            <p className="mt-1 text-copy-13 text-muted-foreground">
              {error
                ? error
                : t("skill_sync_result_summary", {
                    success: ok.length,
                    failed: failed.length,
                  })}
            </p>
          </div>
        </div>
        {state && (
          <div className="flex flex-wrap gap-2">
            <Badge variant="success">
              {t("skill_sync_success", { count: ok.length })}
            </Badge>
            <Badge variant={failed.length > 0 ? "destructive" : "outline"}>
              {t("skill_sync_error_count", { count: failed.length })}
            </Badge>
          </div>
        )}
      </div>

      {failed.length > 0 && (
        <div className="mt-3 grid gap-2">
          {failed.slice(0, 5).map((result) => (
            <div
              key={`${result.skillId}:${result.agentKey}:${result.targetPath}`}
              className="rounded-sm border border-border bg-card px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2 text-label-12 font-medium">
                <span>{result.skillName}</span>
                <span className="text-muted-foreground">/</span>
                <span>{result.agentName}</span>
                <Badge variant="destructive">{result.scope}</Badge>
              </div>
              <p className="mt-1 truncate font-mono text-label-12 text-muted-foreground">
                {result.targetPath}
              </p>
              <p className="mt-1 text-label-12 text-destructive">
                {result.error}
              </p>
            </div>
          ))}
          {failed.length > 5 && (
            <p className="text-label-12 text-muted-foreground">
              {t("skill_sync_more_errors", { count: failed.length - 5 })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function StatusCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-border bg-background-secondary px-3 py-2">
      <div className="text-label-12 text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-label-13 font-medium">{value}</div>
    </div>
  );
}

function LabelRow({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 text-label-12 text-muted-foreground">
      {icon}
      <span className="truncate">{children}</span>
    </div>
  );
}

function getProjectReadiness(
  project: SkillProjectConfig,
  selectedSkills: Skill[],
  t: Translate
): ProjectReadiness {
  const selectedCount = selectedSkills.length;
  const enabledSelectedCount = selectedSkills.filter((skill) => skill.enabled).length;

  if (!project.enabled) {
    return {
      canSync: false,
      reason: t("skill_project_blocked_disabled"),
      selectedCount,
      enabledSelectedCount,
    };
  }
  if (!project.projectPath.trim()) {
    return {
      canSync: false,
      reason: t("skill_project_blocked_path"),
      selectedCount,
      enabledSelectedCount,
    };
  }
  if (project.agentKeys.length === 0) {
    return {
      canSync: false,
      reason: t("skill_project_blocked_agents"),
      selectedCount,
      enabledSelectedCount,
    };
  }
  if (selectedCount === 0) {
    return {
      canSync: false,
      reason: t("skill_project_blocked_skills"),
      selectedCount,
      enabledSelectedCount,
    };
  }
  if (enabledSelectedCount === 0) {
    return {
      canSync: false,
      reason: t("skill_project_blocked_enabled_skills"),
      selectedCount,
      enabledSelectedCount,
    };
  }
  return {
    canSync: true,
    reason: t("skill_project_sync_ready", {
      skills: enabledSelectedCount,
      agents: project.agentKeys.length,
    }),
    selectedCount,
    enabledSelectedCount,
  };
}

function RowMenu({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("pages");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("actions", { ns: "common" })}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit}>
          <Pencil className="h-4 w-4" />
          {t("edit", { ns: "common" })}
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
