import { isTauri } from "@/lib/utils";
import type { CellRuntime, ShellNotebookCell } from "@/pages/tools/shellNotebook";

export type ShellNotebookErrorCode =
  | "desktop_only"
  | "bash_not_found"
  | "invalid_working_directory"
  | "session_not_found"
  | "session_busy"
  | "source_too_large"
  | "spawn_failed"
  | "stdin_write_failed"
  | "protocol_lost"
  | "session_terminated"
  | "export_failed"
  | "unknown";

export class ShellNotebookError extends Error {
  constructor(
    public readonly code: ShellNotebookErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ShellNotebookError";
  }
}

export interface ShellNotebookConfig {
  startDirectory: string;
}

export interface ShellNotebookSessionInfo {
  sessionId: string;
  currentDirectory: string;
}

export type ShellNotebookEvent =
  | { type: "ready"; sessionId: string; currentDirectory: string }
  | { type: "runStarted"; runId: string; startedAt: number }
  | { type: "output"; runId: string; stream: "stdout" | "stderr"; chunk: string }
  | {
      type: "runFinished";
      runId: string;
      exitCode: number;
      durationMs: number;
      truncated: boolean;
      currentDirectory: string;
    }
  | { type: "runCancelled"; runId: string; stateReset: boolean }
  | { type: "sessionTerminated"; runId?: string; reason: string }
  | { type: "error"; code: ShellNotebookErrorCode; message: string; runId?: string };

export interface ShellNotebookRuntime {
  cells: Record<string, CellRuntime>;
  currentDirectory: string;
  sessionStatus: "unstarted" | "ready" | "lost";
  error?: { code: ShellNotebookErrorCode; message: string };
}

function emptyRuntime(): CellRuntime {
  return {
    status: "idle",
    stdout: "",
    stderr: "",
  };
}

export function createShellNotebookRuntime(cellIds: string[]): ShellNotebookRuntime {
  return {
    cells: Object.fromEntries(cellIds.map((id) => [id, emptyRuntime()])),
    currentDirectory: "",
    sessionStatus: "unstarted",
  };
}

function cellIdForRun(state: ShellNotebookRuntime, runId: string): string | undefined {
  return Object.entries(state.cells).find(([, runtime]) => runtime.runId === runId)?.[0];
}

function updateCell(
  state: ShellNotebookRuntime,
  cellId: string,
  update: (runtime: CellRuntime) => CellRuntime,
): ShellNotebookRuntime {
  const runtime = state.cells[cellId];
  if (!runtime) return state;
  return {
    ...state,
    cells: {
      ...state.cells,
      [cellId]: update(runtime),
    },
  };
}

/**
 * Applies the typed IPC event stream in one place. Events for obsolete run IDs
 * are intentionally ignored, so a late channel message cannot overwrite a
 * newer execution result.
 */
export function applyShellNotebookEvent(
  state: ShellNotebookRuntime,
  event: ShellNotebookEvent,
): ShellNotebookRuntime {
  switch (event.type) {
    case "ready":
      return {
        ...state,
        currentDirectory: event.currentDirectory,
        sessionStatus: "ready",
        error: undefined,
      };
    case "runStarted": {
      const cellId = cellIdForRun(state, event.runId);
      return cellId
        ? updateCell(state, cellId, (runtime) => ({ ...runtime, status: "running" }))
        : state;
    }
    case "output": {
      const cellId = cellIdForRun(state, event.runId);
      if (!cellId) return state;
      return updateCell(state, cellId, (runtime) => ({
        ...runtime,
        [event.stream]: runtime[event.stream] + event.chunk,
      }));
    }
    case "runFinished": {
      const cellId = cellIdForRun(state, event.runId);
      if (!cellId) return state;
      const next = updateCell(state, cellId, (runtime) => ({
        ...runtime,
        status: event.exitCode === 0 ? "success" : "failed",
        exitCode: event.exitCode,
        durationMs: event.durationMs,
        truncated: event.truncated,
      }));
      return { ...next, currentDirectory: event.currentDirectory };
    }
    case "runCancelled": {
      const cellId = cellIdForRun(state, event.runId);
      return cellId
        ? updateCell(state, cellId, (runtime) => ({ ...runtime, status: "cancelled" }))
        : state;
    }
    case "sessionTerminated": {
      const affected = event.runId
        ? cellIdForRun(state, event.runId)
        : Object.entries(state.cells).find(([, runtime]) => runtime.status === "running")?.[0];
      const next = affected
        ? updateCell(state, affected, (runtime) => ({ ...runtime, status: "session-lost" }))
        : state;
      return {
        ...next,
        sessionStatus: "lost",
        error: { code: "session_terminated", message: event.reason },
      };
    }
    case "error": {
      const cellId = event.runId ? cellIdForRun(state, event.runId) : undefined;
      const next = cellId
        ? updateCell(state, cellId, (runtime) => ({
            ...runtime,
            status: event.code === "session_terminated" ? "session-lost" : "failed",
          }))
        : state;
      return {
        ...next,
        sessionStatus:
          event.code === "session_terminated" ? "lost" : next.sessionStatus,
        error: { code: event.code, message: event.message },
      };
    }
  }
}

function longestBacktickRun(source: string): number {
  return Math.max(0, ...Array.from(source.matchAll(/`+/g), (match) => match[0].length));
}

export function buildShellNotebookMarkdown(cells: readonly ShellNotebookCell[]): string {
  return cells
    .filter((cell) => cell.source.trim().length > 0)
    .map((cell) => {
      const fence = "`".repeat(Math.max(3, longestBacktickRun(cell.source) + 1));
      const trailingNewline = cell.source.endsWith("\n") ? "" : "\n";
      return `${fence}shell\n${cell.source}${trailingNewline}${fence}`;
    })
    .join("\n\n");
}

function requireDesktop(): void {
  if (!isTauri()) {
    throw new ShellNotebookError(
      "desktop_only",
      "Shell Notebook execution is only available in the desktop app.",
    );
  }
}

function normalizeError(error: unknown): ShellNotebookError {
  if (error instanceof ShellNotebookError) return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    return new ShellNotebookError(error.code as ShellNotebookErrorCode, error.message);
  }
  return new ShellNotebookError("unknown", String(error));
}

async function invokeShellNotebook<T>(
  command: string,
  args: Record<string, unknown>,
): Promise<T> {
  requireDesktop();
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function openShellNotebook(
  config: ShellNotebookConfig,
  onEvent: (event: ShellNotebookEvent) => void,
): Promise<ShellNotebookSessionInfo> {
  requireDesktop();
  const { Channel } = await import("@tauri-apps/api/core");
  const channel = new Channel<ShellNotebookEvent>();
  channel.onmessage = onEvent;
  return invokeShellNotebook<ShellNotebookSessionInfo>("shell_notebook_open", {
    config,
    onEvent: channel,
  });
}

export function executeShellNotebookCell(
  sessionId: string,
  runId: string,
  source: string,
): Promise<void> {
  return invokeShellNotebook("shell_notebook_execute", { sessionId, runId, source });
}

export function stopShellNotebook(sessionId: string): Promise<ShellNotebookSessionInfo> {
  return invokeShellNotebook("shell_notebook_stop", { sessionId });
}

export function restartShellNotebook(
  sessionId: string,
  config: ShellNotebookConfig,
): Promise<ShellNotebookSessionInfo> {
  return invokeShellNotebook("shell_notebook_restart", { sessionId, config });
}

export function closeShellNotebook(sessionId: string): Promise<void> {
  return invokeShellNotebook("shell_notebook_close", { sessionId });
}

export function exportShellNotebookMarkdown(path: string, contents: string): Promise<void> {
  return invokeShellNotebook("shell_notebook_export_markdown", { path, contents });
}
