import { create } from "zustand";

const MODE_KEY = "llmtoolforge.appMode";

export type AppMode = "tool" | "agent";

function getInitialMode(): AppMode {
  if (typeof window === "undefined") return "tool";
  return localStorage.getItem(MODE_KEY) === "agent" ? "agent" : "tool";
}

interface AppModeState {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  toggle: () => void;
}

export const useAppModeStore = create<AppModeState>((set, get) => ({
  mode: getInitialMode(),
  setMode: (mode) => {
    localStorage.setItem(MODE_KEY, mode);
    set({ mode });
  },
  toggle: () => get().setMode(get().mode === "tool" ? "agent" : "tool"),
}));
