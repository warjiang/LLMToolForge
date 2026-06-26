import { create } from "zustand";
import { uid } from "@/lib/utils";

const GROUPS_KEY = "llmtoolforge.session.groups";
const ASSIGN_KEY = "llmtoolforge.session.groupAssignments";
const COLLAPSED_KEY = "llmtoolforge.session.collapsedGroups";
const ORDER_KEY = "llmtoolforge.session.order";

export interface SessionGroup {
  id: string;
  name: string;
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

interface SessionGroupState {
  groups: SessionGroup[];
  // sessionId -> groupId
  assignments: Record<string, string>;
  // groupId -> collapsed
  collapsed: Record<string, boolean>;
  // custom display order of session ids (ids absent fall back to natural order)
  order: string[];
  addGroup: (name?: string) => string;
  renameGroup: (id: string, name: string) => void;
  removeGroup: (id: string) => void;
  assign: (sessionId: string, groupId: string | null) => void;
  toggleCollapsed: (groupId: string) => void;
  setArrangement: (assignments: Record<string, string>, order: string[]) => void;
}

export const useSessionGroupStore = create<SessionGroupState>((set, get) => ({
  groups: readJson<SessionGroup[]>(GROUPS_KEY, []),
  assignments: readJson<Record<string, string>>(ASSIGN_KEY, {}),
  collapsed: readJson<Record<string, boolean>>(COLLAPSED_KEY, {}),
  order: readJson<string[]>(ORDER_KEY, []),

  addGroup: (name) => {
    const group: SessionGroup = { id: uid("grp"), name: name?.trim() ?? "" };
    const groups = [...get().groups, group];
    writeJson(GROUPS_KEY, groups);
    set({ groups });
    return group.id;
  },

  renameGroup: (id, name) => {
    const groups = get().groups.map((g) =>
      g.id === id ? { ...g, name: name.trim() } : g
    );
    writeJson(GROUPS_KEY, groups);
    set({ groups });
  },

  removeGroup: (id) => {
    const groups = get().groups.filter((g) => g.id !== id);
    const assignments = { ...get().assignments };
    for (const sid of Object.keys(assignments)) {
      if (assignments[sid] === id) delete assignments[sid];
    }
    const collapsed = { ...get().collapsed };
    delete collapsed[id];
    writeJson(GROUPS_KEY, groups);
    writeJson(ASSIGN_KEY, assignments);
    writeJson(COLLAPSED_KEY, collapsed);
    set({ groups, assignments, collapsed });
  },

  assign: (sessionId, groupId) => {
    const assignments = { ...get().assignments };
    if (groupId) assignments[sessionId] = groupId;
    else delete assignments[sessionId];
    writeJson(ASSIGN_KEY, assignments);
    set({ assignments });
  },

  toggleCollapsed: (groupId) => {
    const collapsed = { ...get().collapsed, [groupId]: !get().collapsed[groupId] };
    writeJson(COLLAPSED_KEY, collapsed);
    set({ collapsed });
  },

  setArrangement: (assignments, order) => {
    writeJson(ASSIGN_KEY, assignments);
    writeJson(ORDER_KEY, order);
    set({ assignments, order });
  },
}));
