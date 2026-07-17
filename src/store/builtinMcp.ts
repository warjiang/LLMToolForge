import { create } from "zustand";
import type { McpServer } from "@/types";
import {
  BUILTIN_MCP_DEFS,
  builtinNeedsInstall,
  getBuiltinDef,
  type BuiltinMcpDef,
} from "@/lib/mcp/builtins";
import { isTauri } from "@/lib/agent/tools/shared";

const STATE_KEY = "llmtoolforge.mcp.builtins";

/** User customizations layered on top of a builtin's shipped defaults. */
export interface BuiltinOverrides {
  description?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

/** Persisted mutable state for one builtin. */
interface BuiltinState {
  enabled: boolean;
  installed: boolean;
  /** Present once the user has edited the shipped config. */
  overrides?: BuiltinOverrides;
}

type BuiltinStateMap = Record<string, BuiltinState>;

/** Local builtins need no install; default them installed + disabled. */
function defaultState(def: BuiltinMcpDef): BuiltinState {
  return { enabled: false, installed: !builtinNeedsInstall(def) };
}

function readPersisted(): BuiltinStateMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as BuiltinStateMap) : {};
  } catch {
    return {};
  }
}

function writePersisted(map: BuiltinStateMap) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STATE_KEY, JSON.stringify(map));
}

/** Fill in defaults for any builtin absent from persisted state. */
function withDefaults(persisted: BuiltinStateMap): BuiltinStateMap {
  const out: BuiltinStateMap = {};
  for (const def of BUILTIN_MCP_DEFS) {
    out[def.id] = { ...defaultState(def), ...persisted[def.id] };
  }
  return out;
}

interface BuiltinMcpStore {
  states: BuiltinStateMap;
  /** ids currently running an install. */
  installing: Record<string, boolean>;
  /** last install error per id, cleared on retry. */
  errors: Record<string, string | undefined>;
  setEnabled: (id: string, enabled: boolean) => void;
  install: (id: string) => Promise<void>;
  uninstall: (id: string) => void;
  /** Save user edits (command/args/env/description/url) for a builtin. */
  setOverrides: (id: string, overrides: BuiltinOverrides) => void;
  /** Discard user edits and revert to the shipped defaults. */
  resetOverrides: (id: string) => void;
}

export const useBuiltinMcpStore = create<BuiltinMcpStore>((set, get) => ({
  states: withDefaults(readPersisted()),
  installing: {},
  errors: {},

  setEnabled: (id, enabled) => {
    const def = getBuiltinDef(id);
    if (!def) return;
    const cur = get().states[id] ?? defaultState(def);
    // Cannot enable a builtin that still needs installing.
    if (enabled && !cur.installed) return;
    const states = { ...get().states, [id]: { ...cur, enabled } };
    writePersisted(states);
    set({ states });
  },

  install: async (id) => {
    const def = getBuiltinDef(id);
    if (!def || !def.install) return;
    if (get().installing[id]) return;
    set({
      installing: { ...get().installing, [id]: true },
      errors: { ...get().errors, [id]: undefined },
    });
    try {
      if (!isTauri()) {
        throw new Error("安装仅在桌面端可用");
      }
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("mcp_install", {
        manager: def.install.manager,
        args: def.install.args,
      });
      const cur = get().states[id] ?? defaultState(def);
      const states = { ...get().states, [id]: { ...cur, installed: true } };
      writePersisted(states);
      set({ states });
    } catch (e) {
      set({
        errors: {
          ...get().errors,
          [id]: e instanceof Error ? e.message : String(e),
        },
      });
      throw e;
    } finally {
      set({ installing: { ...get().installing, [id]: false } });
    }
  },

  uninstall: (id) => {
    const def = getBuiltinDef(id);
    if (!def || !def.install) return;
    const cur = get().states[id] ?? defaultState(def);
    // Uninstalling forces the tool off as well.
    const states = {
      ...get().states,
      [id]: { ...cur, installed: false, enabled: false },
    };
    writePersisted(states);
    set({ states, errors: { ...get().errors, [id]: undefined } });
  },

  setOverrides: (id, overrides) => {
    const def = getBuiltinDef(id);
    if (!def) return;
    const cur = get().states[id] ?? defaultState(def);
    // Drop empty keys so an untouched builtin has no overrides object.
    const cleaned: BuiltinOverrides = {};
    if (overrides.description !== undefined)
      cleaned.description = overrides.description;
    if (overrides.command !== undefined) cleaned.command = overrides.command;
    if (overrides.args !== undefined) cleaned.args = overrides.args;
    if (overrides.env !== undefined) cleaned.env = overrides.env;
    if (overrides.url !== undefined) cleaned.url = overrides.url;
    const states = {
      ...get().states,
      [id]: { ...cur, overrides: cleaned },
    };
    writePersisted(states);
    set({ states });
  },

  resetOverrides: (id) => {
    const def = getBuiltinDef(id);
    if (!def) return;
    const cur = get().states[id] ?? defaultState(def);
    const next = { ...cur };
    delete next.overrides;
    const states = { ...get().states, [id]: next };
    writePersisted(states);
    set({ states });
  },
}));

/** Build the `McpServer` view of a builtin, merging its persisted state. */
function toServer(def: BuiltinMcpDef, state: BuiltinState): McpServer {
  const o = state.overrides ?? {};
  return {
    id: def.id,
    name: def.name,
    description: o.description ?? def.description,
    transport: def.transport,
    command: o.command ?? def.command,
    args: o.args ?? def.args,
    url: o.url ?? undefined,
    env: o.env ?? {},
    enabled: state.enabled,
    builtin: def.kind,
    installed: state.installed,
    createdAt: "",
    updatedAt: "",
  };
}

/** Whether the user has customized this builtin away from its defaults. */
export function builtinHasOverrides(
  states: Record<string, { overrides?: unknown }>,
  id: string
): boolean {
  return states[id]?.overrides !== undefined;
}

/** All builtins as `McpServer` objects (regardless of enabled/installed). */
export function builtinServers(states: BuiltinStateMap): McpServer[] {
  return BUILTIN_MCP_DEFS.map((def) =>
    toServer(def, states[def.id] ?? defaultState(def))
  );
}

/** Non-react accessor for all builtin servers with their current state. */
export function getAllBuiltinServers(): McpServer[] {
  return builtinServers(useBuiltinMcpStore.getState().states);
}

/**
 * Non-react accessor: builtins that are both installed and enabled, as servers
 * ready to hand to the tool builder. Used by the agent runtime.
 */
export function getActiveBuiltinServers(): McpServer[] {
  const states = useBuiltinMcpStore.getState().states;
  return builtinServers(states).filter((s) => s.installed && s.enabled);
}
