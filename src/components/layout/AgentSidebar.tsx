import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Check,
  ChevronRight,
  CircleAlert,
  Folder,
  FolderPlus,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  Moon,
  Pencil,
  Settings2,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormModeToggle } from "./FormModeToggle";
import { AgentsManagerDialog } from "@/pages/agent/agents/AgentsManagerDialog";
import { useChatStore, useAgentDefStore } from "@/store";
import { useSidebarStore } from "@/store/sidebar";
import { useSessionGroupStore } from "@/store/sessionGroups";
import { useThemeStore } from "@/store/theme";
import { useLocaleStore } from "@/store/locale";
import { cn, formatDateTime } from "@/lib/utils";
import {
  DATA_AGENT_ID,
  DIRECT_AGENT_VALUE,
  RESEARCH_AGENT_ID,
  resolveAgentLabel,
} from "@/lib/agent/builtinAgents";
import { ResizeHandle } from "@/components/common/ResizeHandle";
import { SIDEBAR_DEFAULT_WIDTH } from "@/store/sidebar";
import type { ChatSession, SessionRunStatus } from "@/types/chat";

const COLLAPSED = 64;

const UNGROUPED = "ungrouped";

const agentValueFromId = (agentId?: string | null) =>
  agentId ?? DIRECT_AGENT_VALUE;

const agentIdFromValue = (value: string) =>
  value === DIRECT_AGENT_VALUE ? null : value;

function DroppableZone({
  id,
  className,
  activeClassName,
  children,
}: {
  id: string;
  className?: string;
  activeClassName?: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cn(className, isOver && activeClassName)}>
      {children}
    </div>
  );
}

function DraggableSession({
  id,
  disabled,
  children,
  onMouseEnter,
  onMouseLeave,
}: {
  id: string;
  disabled?: boolean;
  children: React.ReactNode;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const {
    setNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group relative rounded-sm outline-none",
        isDragging ? "opacity-40" : !disabled && "cursor-grab"
      )}
    >
      {children}
    </div>
  );
}

function SessionStatusBadge({ status }: { status?: SessionRunStatus }) {
  const { t } = useTranslation("common");
  if (!status) return null;
  if (status === "running") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-1.5 py-px font-medium text-primary">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t("session_status_running")}
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-destructive/10 px-1.5 py-px font-medium text-destructive">
        <CircleAlert className="h-3 w-3" />
        {t("session_status_error")}
      </span>
    );
  }
  return null;
}

export function AgentSidebar() {
  const { t } = useTranslation("common");
  const reduce = useReducedMotion();
  const collapsed = useSidebarStore((s) => s.collapsed);
  const sidebarWidth = useSidebarStore((s) => s.width);
  const setSidebarWidth = useSidebarStore((s) => s.setWidth);
  const sessions = useChatStore((s) => s.sessions);
  const agentDefs = useAgentDefStore((s) => s.items);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const sessionStatus = useChatStore((s) => s.sessionStatus);
  const loadingSessions = useChatStore((s) => s.loading);
  const newSession = useChatStore((s) => s.newSession);
  const selectSession = useChatStore((s) => s.selectSession);
  const renameSession = useChatStore((s) => s.renameSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const language = useLocaleStore((s) => s.language);
  const setLanguage = useLocaleStore((s) => s.setLanguage);

  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [resizing, setResizing] = useState(false);
  const resizeBaseRef = useRef(SIDEBAR_DEFAULT_WIDTH);

  const groups = useSessionGroupStore((s) => s.groups);
  const assignments = useSessionGroupStore((s) => s.assignments);
  const collapsedGroups = useSessionGroupStore((s) => s.collapsed);
  const order = useSessionGroupStore((s) => s.order);
  const addGroup = useSessionGroupStore((s) => s.addGroup);
  const renameGroup = useSessionGroupStore((s) => s.renameGroup);
  const removeGroup = useSessionGroupStore((s) => s.removeGroup);
  const setArrangement = useSessionGroupStore((s) => s.setArrangement);
  const toggleGroupCollapsed = useSessionGroupStore((s) => s.toggleCollapsed);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);
  const [pendingNewGroupId, setPendingNewGroupId] = useState<string | null>(null);

  const sessionById = useMemo(() => {
    const m = new Map<string, ChatSession>();
    for (const s of sessions) m.set(s.id, s);
    return m;
  }, [sessions]);

  const activeSession = activeSessionId
    ? sessionById.get(activeSessionId) ?? null
    : null;
  const [agentFilterValue, setAgentFilterValue] = useState(
    () => activeSession?.agentId ?? DIRECT_AGENT_VALUE
  );
  const activeAgentLabel =
    resolveAgentLabel(agentIdFromValue(agentFilterValue), agentDefs) ??
    t("default_agent");
  const visibleSessions = useMemo(
    () =>
      sessions.filter(
        (session) => agentValueFromId(session.agentId) === agentFilterValue
      ),
    [agentFilterValue, sessions]
  );
  const agentFilterTouchedRef = useRef(false);
  const ensureSessionForAgentRef = useRef<string | null>(null);

  // Build per-container ordered session-id lists from store state.
  const baseContainers = useMemo(() => {
    const orderIndex = new Map<string, number>();
    order.forEach((id, i) => orderIndex.set(id, i));
    // Sessions absent from the custom order (e.g. freshly created ones) sort to
    // the front, keeping the store's newest-first order among themselves, so a
    // new session always shows at the top rather than sinking below arranged
    // ones.
    const sorted = [...visibleSessions].sort((a, b) => {
      const ai = orderIndex.get(a.id);
      const bi = orderIndex.get(b.id);
      if (ai === undefined && bi === undefined) return 0;
      if (ai === undefined) return -1;
      if (bi === undefined) return 1;
      return ai - bi;
    });
    const result: Record<string, string[]> = { [UNGROUPED]: [] };
    for (const g of groups) result[g.id] = [];
    for (const s of sorted) {
      const gid = assignments[s.id];
      if (gid && result[gid]) result[gid].push(s.id);
      else result[UNGROUPED].push(s.id);
    }
    return result;
  }, [visibleSessions, groups, assignments, order]);

  // Live working copy during a drag; resynced from store when not dragging.
  const [containers, setContainers] =
    useState<Record<string, string[]>>(baseContainers);
  useEffect(() => {
    if (!draggingId) setContainers(baseContainers);
  }, [baseContainers, draggingId]);

  useEffect(() => {
    void useAgentDefStore.getState().load();
  }, []);

  const pendingDeleteGroup = groups.find((g) => g.id === deleteGroupId);

  const pendingDelete = sessions.find((s) => s.id === deleteSessionId);
  const canDeleteSession = sessions.length > 1;

  const handleAgentChange = (value: string) => {
    agentFilterTouchedRef.current = true;
    setAgentFilterValue(value);
  };

  useEffect(() => {
    if (loadingSessions || sessions.length === 0) return;
    if (
      activeSession &&
      !agentFilterTouchedRef.current &&
      agentValueFromId(activeSession.agentId) !== agentFilterValue
    ) {
      setAgentFilterValue(agentValueFromId(activeSession.agentId));
      return;
    }
    if (
      activeSession &&
      agentValueFromId(activeSession.agentId) === agentFilterValue
    ) {
      if (ensureSessionForAgentRef.current === agentFilterValue) {
        ensureSessionForAgentRef.current = null;
      }
      return;
    }

    const nextSession = visibleSessions[0];
    if (nextSession) {
      void selectSession(nextSession.id);
      return;
    }

    if (ensureSessionForAgentRef.current === agentFilterValue) return;
    ensureSessionForAgentRef.current = agentFilterValue;
    void newSession(agentIdFromValue(agentFilterValue)).finally(() => {
      if (ensureSessionForAgentRef.current === agentFilterValue) {
        ensureSessionForAgentRef.current = null;
      }
    });
  }, [
    activeSession?.agentId,
    activeSession?.id,
    agentFilterValue,
    loadingSessions,
    newSession,
    selectSession,
    sessions.length,
    visibleSessions,
  ]);

  const startRename = (id: string, title: string) => {
    setRenamingId(id);
    setRenameDraft(title);
  };
  const commitRename = (id: string) => {
    void renameSession(id, renameDraft);
    setRenamingId(null);
    setRenameDraft("");
  };
  const startGroupRename = (id: string, name: string) => {
    setEditingGroupId(id);
    setGroupNameDraft(name);
  };
  const commitGroupRename = (id: string) => {
    const name = groupNameDraft.trim();
    renameGroup(id, name || t("default_group_name"));
    setEditingGroupId(null);
    setGroupNameDraft("");
    setPendingNewGroupId(null);
  };
  const skipGroupBlurRef = useRef(false);
  const cancelGroupRename = (id: string) => {
    // Esc on a just-created group removes it; the session falls back to ungrouped.
    skipGroupBlurRef.current = true;
    if (pendingNewGroupId === id) {
      removeGroup(id);
      setPendingNewGroupId(null);
    }
    setEditingGroupId(null);
    setGroupNameDraft("");
  };

  // Drag-and-drop via @dnd-kit (pointer sensors work reliably in Tauri/WebKit).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const findContainer = (id: string): string | undefined => {
    if (id in containers) return id;
    return Object.keys(containers).find((key) => containers[key].includes(id));
  };

  const buildAssignments = (state: Record<string, string[]>) => {
    const next: Record<string, string> = { ...assignments };
    for (const session of visibleSessions) delete next[session.id];
    for (const key of Object.keys(state)) {
      if (key === UNGROUPED) continue;
      for (const sid of state[key]) next[sid] = key;
    }
    return next;
  };
  const buildOrder = (state: Record<string, string[]>) => {
    const visibleSet = new Set(visibleSessions.map((session) => session.id));
    const next: string[] = [];
    for (const g of groups) if (state[g.id]) next.push(...state[g.id]);
    next.push(...(state[UNGROUPED] ?? []));
    const hiddenOrdered = order.filter((id) => !visibleSet.has(id));
    const hiddenNew = sessions
      .filter(
        (session) =>
          !visibleSet.has(session.id) && !hiddenOrdered.includes(session.id)
      )
      .map((session) => session.id);
    return [...next, ...hiddenOrdered, ...hiddenNew];
  };

  const handleDragStart = (e: DragStartEvent) => {
    setDraggingId(String(e.active.id));
  };

  const handleDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (overId === "new") return;
    const activeContainer = findContainer(activeId);
    const overContainer = findContainer(overId);
    if (!activeContainer || !overContainer || activeContainer === overContainer)
      return;
    setContainers((prev) => {
      const activeItems = prev[activeContainer];
      const overItems = prev[overContainer];
      const overIndex = overItems.indexOf(overId);
      const newIndex = overId in prev ? overItems.length : Math.max(overIndex, 0);
      return {
        ...prev,
        [activeContainer]: activeItems.filter((id) => id !== activeId),
        [overContainer]: [
          ...overItems.slice(0, newIndex),
          activeId,
          ...overItems.slice(newIndex),
        ],
      };
    });
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    setDraggingId(null);
    if (!over) {
      setContainers(baseContainers);
      return;
    }
    const activeId = String(active.id);
    const overId = String(over.id);

    if (overId === "new") {
      const gid = addGroup(t("default_group_name"));
      const assignmentsOut = buildAssignments(containers);
      assignmentsOut[activeId] = gid;
      setArrangement(assignmentsOut, buildOrder(containers));
      startGroupRename(gid, "");
      setPendingNewGroupId(gid);
      return;
    }

    let next = containers;
    const activeContainer = findContainer(activeId);
    const overContainer = findContainer(overId);
    if (activeContainer && overContainer && activeContainer === overContainer) {
      const items = containers[activeContainer];
      const from = items.indexOf(activeId);
      const to = items.indexOf(overId);
      if (from !== -1 && to !== -1 && from !== to) {
        next = { ...containers, [activeContainer]: arrayMove(items, from, to) };
        setContainers(next);
      }
    }
    setArrangement(buildAssignments(next), buildOrder(next));
  };

  const draggingSession = draggingId ? sessionById.get(draggingId) : null;

  const renderSessionId = (id: string) => {
    const session = sessionById.get(id);
    if (!session) return null;
    return renderSession(session);
  };

  const renderSession = (session: ChatSession) => {
    const active = activeSessionId === session.id;
    const renaming = renamingId === session.id;
    const hovered = hoveredSessionId === session.id;
    return (
      <DraggableSession
        key={session.id}
        id={session.id}
        disabled={renaming}
        onMouseEnter={() => setHoveredSessionId(session.id)}
        onMouseLeave={() =>
          setHoveredSessionId((cur) => (cur === session.id ? null : cur))
        }
      >
        {renaming ? (
          <div className="flex items-center gap-1 px-1 py-1">
            <Input
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename(session.id);
                if (e.key === "Escape") setRenamingId(null);
              }}
              className="h-7 text-label-13"
            />
            <Button
              size="icon-sm"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              title={t("save")}
              onClick={() => commitRename(session.id)}
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              title={t("cancel")}
              onClick={() => setRenamingId(null)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <>
            <button
              className={cn(
                "block w-full rounded-sm px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none",
                active && "bg-muted ring-1 ring-inset ring-border"
              )}
              onClick={() => selectSession(session.id)}
            >
              <span
                className={cn(
                  "flex items-center gap-1 text-label-13 font-medium leading-5",
                  hovered ? "pr-14" : "pr-2"
                )}
              >
                <span className="min-w-0 flex-1 truncate">{session.title}</span>
              </span>
              <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-label-12 tabular-nums text-muted-foreground">
                <span className="shrink-0">{formatDateTime(session.updatedAt)}</span>
                <SessionStatusBadge status={sessionStatus[session.id]} />
              </span>
            </button>
            {hovered && (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute right-2 top-2 flex items-center gap-0.5"
              >
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="h-6 w-6 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                  title={t("rename_session")}
                  onClick={() => startRename(session.id, session.title)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {canDeleteSession && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="h-6 w-6 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    title={t("delete_session")}
                    onClick={() => setDeleteSessionId(session.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </DraggableSession>
    );
  };

  return (
    <>
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? COLLAPSED : sidebarWidth }}
      transition={
        reduce || resizing
          ? { duration: 0 }
          : { type: "spring", stiffness: 420, damping: 38 }
      }
      className="flex h-full shrink-0 flex-col overflow-hidden border-r border-border bg-chrome"
    >
      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-b border-border",
          collapsed ? "justify-center px-2" : "justify-between px-3"
        )}
      >
        {!collapsed && (
          <Select
            value={agentFilterValue}
            onValueChange={handleAgentChange}
            disabled={loadingSessions}
          >
            <SelectTrigger
              className="h-9 min-w-0 flex-1 gap-2 border-transparent bg-transparent px-1.5 text-label-13 font-medium shadow-none hover:bg-secondary/60"
              title={activeAgentLabel}
            >
              <img
                src="/icons/logo.png"
                alt=""
                className="h-7 w-7 shrink-0 rounded-md object-contain"
              />
              <span className="min-w-0 flex-1 truncate text-left">
                <SelectValue placeholder={activeAgentLabel} />
              </span>
            </SelectTrigger>
            <SelectContent align="start">
              <SelectItem value={DIRECT_AGENT_VALUE}>
                {t("default_agent")}
              </SelectItem>
              <SelectItem value={DATA_AGENT_ID}>DataAgent</SelectItem>
              <SelectItem
                value={RESEARCH_AGENT_ID}
                description={t("agent_research_selector_desc")}
              >
                ResearchAgent
              </SelectItem>
              {agentDefs.map((def) => (
                <SelectItem key={def.id} value={def.id}>
                  {def.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex items-center gap-0.5">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => setManagerOpen(true)}
            title={t("agents_manage_title", { ns: "pages" })}
            aria-label={t("agents_manage_title", { ns: "pages" })}
          >
            <Settings2 className="h-4 w-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => newSession(agentIdFromValue(agentFilterValue))}
            title={t("new_session")}
            aria-label={t("new_session")}
          >
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {collapsed ? (
          <div className="flex flex-col gap-1">
            {visibleSessions.map((session) => {
              const active = activeSessionId === session.id;
              const status = sessionStatus[session.id];
              return (
                <button
                  key={session.id}
                  title={session.title}
                  onClick={() => selectSession(session.id)}
                  className={cn(
                    "relative flex h-9 w-9 items-center justify-center self-center rounded-sm transition-colors",
                    active
                      ? "bg-muted text-foreground ring-1 ring-inset ring-border"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  )}
                >
                  <MessageSquare className="h-4 w-4" />
                  {(status === "running" || status === "error") && (
                    <span
                      className={cn(
                        "absolute right-1 top-1 h-2 w-2 rounded-full ring-2 ring-card-elevated",
                        status === "running" && "animate-pulse bg-primary",
                        status === "error" && "bg-destructive"
                      )}
                    />
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <div className="flex flex-col gap-1.5">
              {groups.map((group) => {
              const groupItems = containers[group.id] ?? [];
              const isGroupCollapsed = collapsedGroups[group.id];
              const editing = editingGroupId === group.id;
              return (
                <DroppableZone
                  key={group.id}
                  id={group.id}
                  className="rounded-md transition-colors"
                  activeClassName="bg-accent-subtle ring-1 ring-inset ring-border"
                >
                  <div className="group/grp flex items-center gap-1 rounded-sm px-1 py-1">
                    <button
                      onClick={() => toggleGroupCollapsed(group.id)}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                      title={group.name || t("default_group_name")}
                    >
                      <ChevronRight
                        className={cn(
                          "h-3.5 w-3.5 transition-transform",
                          !isGroupCollapsed && "rotate-90"
                        )}
                      />
                    </button>
                    <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {editing ? (
                      <Input
                        autoFocus
                        value={groupNameDraft}
                        onChange={(e) => setGroupNameDraft(e.target.value)}
                        onBlur={() => {
                          if (skipGroupBlurRef.current) {
                            skipGroupBlurRef.current = false;
                            return;
                          }
                          commitGroupRename(group.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitGroupRename(group.id);
                          if (e.key === "Escape") cancelGroupRename(group.id);
                        }}
                        className="h-6 flex-1 text-label-12"
                      />
                    ) : (
                      <button
                        onClick={() => startGroupRename(group.id, group.name)}
                        title={t("rename_group")}
                        className="min-w-0 flex-1 truncate text-left text-label-12 font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
                      >
                        {group.name || t("default_group_name")}
                      </button>
                    )}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="h-6 w-6 shrink-0 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover/grp:opacity-100"
                      title={t("delete_group")}
                      onClick={() => setDeleteGroupId(group.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {!isGroupCollapsed && (
                    <SortableContext
                      items={groupItems}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="ml-3 flex flex-col gap-1 border-l border-border/60 pb-1 pl-1.5">
                        {groupItems.length === 0 ? (
                          <div className="px-2 py-1.5 text-label-12 text-muted-foreground/70">
                            {t("group_drop_hint")}
                          </div>
                        ) : (
                          groupItems.map(renderSessionId)
                        )}
                      </div>
                    </SortableContext>
                  )}
                </DroppableZone>
              );
            })}

            <SortableContext
              items={containers[UNGROUPED] ?? []}
              strategy={verticalListSortingStrategy}
            >
              <DroppableZone
                id={UNGROUPED}
                className="flex flex-col gap-1 rounded-md transition-colors"
                activeClassName="bg-accent-subtle ring-1 ring-inset ring-border"
              >
                {(containers[UNGROUPED] ?? []).map(renderSessionId)}
              </DroppableZone>
            </SortableContext>

            {draggingId && (
              <DroppableZone
                id="new"
                className="mt-1 flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-2 py-2.5 text-label-12 text-muted-foreground transition-colors"
                activeClassName="border-foreground/40 bg-accent-subtle text-foreground"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                {t("drop_to_new_group")}
              </DroppableZone>
            )}
            </div>
            <DragOverlay dropAnimation={null}>
              {draggingSession ? (
                <div className="flex max-w-[216px] items-center gap-1.5 rounded-md border border-border bg-popover px-2.5 py-2 text-label-13 font-medium text-popover-foreground shadow-geist-md">
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{draggingSession.title}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      <div
        className={cn(
          "flex border-t border-border/60 py-3",
          collapsed
            ? "flex-col items-center gap-1 px-2"
            : "items-center justify-between px-3"
        )}
      >
        <div
          className={cn(
            "flex items-center",
            collapsed ? "flex-col gap-1" : "gap-1"
          )}
        >
          <button
            onClick={toggleTheme}
            aria-label={t("theme_toggle")}
            title={theme === "dark" ? t("switch_to_light") : t("switch_to_dark")}
            className="flex h-9 w-9 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 hover:bg-secondary/60 hover:text-foreground"
          >
            <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={theme}
                  initial={reduce ? false : { opacity: 0, rotate: -90, scale: 0.6 }}
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  exit={reduce ? undefined : { opacity: 0, rotate: 90, scale: 0.6 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  {theme === "dark" ? (
                    <Sun className="h-4 w-4" />
                  ) : (
                    <Moon className="h-4 w-4" />
                  )}
                </motion.span>
              </AnimatePresence>
            </span>
          </button>

          <button
            onClick={() => setLanguage(language === "zh" ? "en" : "zh")}
            aria-label={t("language")}
            title={t("select_language")}
            className="flex h-9 w-9 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 hover:bg-secondary/60 hover:text-foreground"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={language}
                initial={reduce ? false : { opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduce ? undefined : { opacity: 0, scale: 0.7 }}
                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                className="text-[11px] font-semibold leading-none"
              >
                {language === "zh" ? t("lang_short_zh") : t("lang_short_en")}
              </motion.span>
            </AnimatePresence>
          </button>
        </div>
        <FormModeToggle />
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setDeleteSessionId(null);
        }}
        title={t("delete_session")}
        description={t("confirm_delete_session", { name: pendingDelete?.title ?? t("sessions") })}
        confirmLabel={t("delete")}
        onConfirm={() => {
          if (pendingDelete) void deleteSession(pendingDelete.id);
          setDeleteSessionId(null);
        }}
      />

      <ConfirmDialog
        open={!!pendingDeleteGroup}
        onOpenChange={(open) => {
          if (!open) setDeleteGroupId(null);
        }}
        title={t("delete_group")}
        description={t("confirm_delete_group", {
          name: pendingDeleteGroup?.name || t("default_group_name"),
        })}
        confirmLabel={t("delete")}
        onConfirm={() => {
          if (pendingDeleteGroup) removeGroup(pendingDeleteGroup.id);
          setDeleteGroupId(null);
        }}
      />

      <AgentsManagerDialog open={managerOpen} onOpenChange={setManagerOpen} />
    </motion.aside>
    {!collapsed && (
      <ResizeHandle
        title={t("resize_sidebar")}
        onStart={() => {
          resizeBaseRef.current = sidebarWidth;
          setResizing(true);
        }}
        onDrag={(dx) => setSidebarWidth(resizeBaseRef.current + dx)}
        onEnd={() => setResizing(false)}
        onReset={() => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
      />
    )}
    </>
  );
}
