import { create } from "zustand";

const COLLAPSED_KEY = "llmtoolforge.sidebar.collapsed";

function getInitialCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(COLLAPSED_KEY) === "1";
}

interface SidebarState {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  toggle: () => void;
}

export const useSidebarStore = create<SidebarState>((set, get) => ({
  collapsed: getInitialCollapsed(),
  setCollapsed: (collapsed) => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    set({ collapsed });
  },
  toggle: () => get().setCollapsed(!get().collapsed),
}));
