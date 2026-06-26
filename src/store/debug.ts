import { create } from "zustand";

const DEBUG_KEY = "llmtoolforge.agent.debug";

function getInitialDebug(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(DEBUG_KEY) === "1";
}

interface DebugState {
  // When enabled, agent (assistant) messages become editable for debugging.
  // Off by default: only user messages can be edited.
  debug: boolean;
  setDebug: (debug: boolean) => void;
  toggle: () => void;
}

export const useDebugStore = create<DebugState>((set, get) => ({
  debug: getInitialDebug(),
  setDebug: (debug) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(DEBUG_KEY, debug ? "1" : "0");
    }
    set({ debug });
  },
  toggle: () => get().setDebug(!get().debug),
}));
