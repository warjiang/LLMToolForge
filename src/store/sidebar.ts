import { create } from "zustand";

const COLLAPSED_KEY = "llmtoolforge.sidebar.collapsed";
const WIDTH_KEY = "llmtoolforge.sidebar.width";

export const SIDEBAR_DEFAULT_WIDTH = 240;
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 440;

function getInitialCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(COLLAPSED_KEY) === "1";
}

function clampWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function getInitialWidth(): number {
  if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH;
  const raw = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(raw) && raw > 0 ? clampWidth(raw) : SIDEBAR_DEFAULT_WIDTH;
}

interface SidebarState {
  collapsed: boolean;
  width: number;
  setCollapsed: (collapsed: boolean) => void;
  toggle: () => void;
  setWidth: (width: number) => void;
}

export const useSidebarStore = create<SidebarState>((set, get) => ({
  collapsed: getInitialCollapsed(),
  width: getInitialWidth(),
  setCollapsed: (collapsed) => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    set({ collapsed });
  },
  toggle: () => get().setCollapsed(!get().collapsed),
  setWidth: (width) => {
    const next = clampWidth(width);
    localStorage.setItem(WIDTH_KEY, String(next));
    set({ width: next });
  },
}));
