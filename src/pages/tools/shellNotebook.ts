import { uid } from "@/lib/utils";

export const SHELL_NOTEBOOK_DRAFT_VERSION = 1;

export interface ShellNotebookCell {
  id: string;
  source: string;
}

export interface ShellNotebookDraftV1 {
  version: typeof SHELL_NOTEBOOK_DRAFT_VERSION;
  cells: ShellNotebookCell[];
  startDirectory: string;
}

export type CellRunStatus =
  | "idle"
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "session-lost";

export interface CellRuntime {
  runId?: string;
  executionCount?: number;
  status: CellRunStatus;
  stdout: string;
  stderr: string;
  exitCode?: number;
  durationMs?: number;
  truncated?: boolean;
  executedSourceHash?: string;
}

function createEmptyCell(): ShellNotebookCell {
  return { id: uid("shell-cell"), source: "" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Converts untyped local persistence into the small, versioned draft contract.
 * Runtime output deliberately has no representation here and is discarded.
 */
export function normalizeShellNotebookDraft(value: unknown): ShellNotebookDraftV1 {
  if (!isRecord(value) || value.version !== SHELL_NOTEBOOK_DRAFT_VERSION) {
    return {
      version: SHELL_NOTEBOOK_DRAFT_VERSION,
      cells: [createEmptyCell()],
      startDirectory: "",
    };
  }

  const cells = Array.isArray(value.cells)
    ? value.cells.flatMap((cell): ShellNotebookCell[] => {
        if (
          !isRecord(cell) ||
          typeof cell.id !== "string" ||
          !cell.id.trim() ||
          typeof cell.source !== "string"
        ) {
          return [];
        }
        return [{ id: cell.id, source: cell.source }];
      })
    : [];

  return {
    version: SHELL_NOTEBOOK_DRAFT_VERSION,
    cells: cells.length > 0 ? cells : [createEmptyCell()],
    startDirectory:
      typeof value.startDirectory === "string" ? value.startDirectory.trim() : "",
  };
}
