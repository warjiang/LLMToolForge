import { create } from "zustand";
import type { SshHost } from "@/types";

/** One open terminal tab. `id` is unique so a single host can have many. */
export interface TerminalTab {
  id: string;
  hostId: string;
  /** Tab label, e.g. "devbox" or "devbox (2)" for a second instance. */
  title: string;
}

let tabSeq = 0;
function nextTabId(): string {
  tabSeq += 1;
  return `tab-${Date.now().toString(36)}-${tabSeq}`;
}

/**
 * Ephemeral (non-persisted) store driving the SSH terminal workspace: a set of
 * tabs, the active one, and whether the fullscreen workspace overlay is shown.
 * Each tab maps to an independent backend SSH session; the same host can be
 * opened multiple times (instance-numbered titles). Tabs persist while their
 * sessions stay connected in the background — closing a tab tears its session
 * down, closing the last tab closes the workspace.
 */
interface SshSessionState {
  tabs: TerminalTab[];
  activeTabId: string | null;
  workspaceOpen: boolean;
  openTab: (host: SshHost) => void;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  closeWorkspace: () => void;
}

export const useSshSessionStore = create<SshSessionState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  workspaceOpen: false,

  openTab: (host) => {
    const { tabs } = get();
    const sameHost = tabs.filter((x) => x.hostId === host.id).length;
    const title = sameHost === 0 ? host.name : `${host.name} (${sameHost + 1})`;
    const tab: TerminalTab = { id: nextTabId(), hostId: host.id, title };
    set({
      tabs: [...tabs, tab],
      activeTabId: tab.id,
      workspaceOpen: true,
    });
  },

  closeTab: (id) => {
    const { tabs, activeTabId } = get();
    const idx = tabs.findIndex((x) => x.id === id);
    if (idx === -1) return;
    const next = tabs.filter((x) => x.id !== id);
    let active = activeTabId;
    if (activeTabId === id) {
      // Prefer the neighbour to the right, else the left, else none.
      const fallback = next[idx] ?? next[idx - 1] ?? null;
      active = fallback ? fallback.id : null;
    }
    set({
      tabs: next,
      activeTabId: active,
      workspaceOpen: next.length > 0,
    });
  },

  setActive: (id) => set({ activeTabId: id }),

  // The top-level close is an explicit "end everything": clearing the tabs
  // unmounts every session (tearing down its connection). Per-tab close is the
  // way to end a single session while keeping the others alive.
  closeWorkspace: () =>
    set({ tabs: [], activeTabId: null, workspaceOpen: false }),
}));
