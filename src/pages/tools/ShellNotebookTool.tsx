import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  FilePlus2,
  FolderOpen,
  Play,
  RotateCcw,
  Square,
  Terminal,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { getStore } from "@/data/storage";
import {
  applyShellNotebookEvent,
  buildShellNotebookMarkdown,
  closeShellNotebook,
  createShellNotebookRuntime,
  executeShellNotebookCell,
  exportShellNotebookMarkdown,
  openShellNotebook,
  restartShellNotebook,
  stopShellNotebook,
  type ShellNotebookEvent,
} from "@/lib/shellNotebook";
import { cn, isTauri, stripAnsi, uid } from "@/lib/utils";
import {
  normalizeShellNotebookDraft,
  type CellRuntime,
  type ShellNotebookCell,
  type ShellNotebookDraftV1,
} from "./shellNotebook";
import { ShellCellEditor } from "./ShellCellEditor";

const DRAFT_KEY = "shell-notebook-draft-v1";

function newCell(): ShellNotebookCell {
  return { id: uid("shell-cell"), source: "" };
}

function newDraft(): ShellNotebookDraftV1 {
  return {
    version: 1,
    cells: [newCell()],
    startDirectory: "",
  };
}

function statusKey(status: CellRuntime["status"]): string {
  return `shell_notebook_status_${status.replace("-", "_")}`;
}

function formatDuration(durationMs: number | undefined): string {
  if (durationMs == null) return "";
  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`;
}

export function ShellNotebookTool() {
  const { t } = useTranslation("pages");
  const [draft, setDraft] = useState<ShellNotebookDraftV1>(newDraft);
  const [runtime, setRuntime] = useState(() => createShellNotebookRuntime([]));
  const [loaded, setLoaded] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDirectory, setPendingDirectory] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pendingRuns = useRef(new Map<string, (success: boolean) => void>());
  const runSources = useRef(new Map<string, string>());

  const applyEvent = useCallback((event: ShellNotebookEvent) => {
    setRuntime((previous) => {
      let next = applyShellNotebookEvent(previous, event);
      if (event.type === "runFinished") {
        const cellId = Object.entries(previous.cells).find(
          ([, value]) => value.runId === event.runId,
        )?.[0];
        if (cellId) {
          const current = next.cells[cellId];
          if (current) {
            next = {
              ...next,
              cells: {
                ...next.cells,
                [cellId]: {
                  ...current,
                  executionCount: (current.executionCount ?? 0) + 1,
                  executedSourceHash: runSources.current.get(event.runId),
                },
              },
            };
          }
        }
      }
      return next;
    });

    if (event.type === "ready") {
      sessionIdRef.current = event.sessionId;
      setSessionId(event.sessionId);
      return;
    }
    if (event.type === "error") {
      setError(event.message);
    }
    if (event.type === "runFinished") {
      pendingRuns.current.get(event.runId)?.(event.exitCode === 0);
      pendingRuns.current.delete(event.runId);
      runSources.current.delete(event.runId);
    }
    if (event.type === "runCancelled" || event.type === "sessionTerminated") {
      if (event.runId) {
        pendingRuns.current.get(event.runId)?.(false);
        pendingRuns.current.delete(event.runId);
        runSources.current.delete(event.runId);
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    void getStore()
      .get<unknown>(DRAFT_KEY)
      .then((stored) => {
        if (active) setDraft(normalizeShellNotebookDraft(stored));
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
      const id = sessionIdRef.current;
      if (id) void closeShellNotebook(id).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    setRuntime((previous) => {
      const cells = Object.fromEntries(
        draft.cells.map((cell) => [cell.id, previous.cells[cell.id] ?? {
          status: "idle" as const,
          stdout: "",
          stderr: "",
        }]),
      );
      return { ...previous, cells };
    });
  }, [draft.cells]);

  useEffect(() => {
    if (loaded) void getStore().set(DRAFT_KEY, draft);
  }, [draft, loaded]);

  const ensureSession = useCallback(async () => {
    if (sessionIdRef.current) return sessionIdRef.current;
    const info = await openShellNotebook(
      { startDirectory: draft.startDirectory },
      applyEvent,
    );
    sessionIdRef.current = info.sessionId;
    setSessionId(info.sessionId);
    setRuntime((previous) => ({
      ...previous,
      currentDirectory: info.currentDirectory,
      sessionStatus: "ready",
    }));
    return info.sessionId;
  }, [applyEvent, draft.startDirectory]);

  const runCell = useCallback(
    async (cell: ShellNotebookCell): Promise<boolean> => {
      if (!isTauri()) {
        setError(t("shell_notebook_desktop_only"));
        return false;
      }
      if (!cell.source.trim()) return true;
      const runId = uid("shell-run");
      try {
        const id = await ensureSession();
        setRuntime((previous) => ({
          ...previous,
          cells: {
            ...previous.cells,
            [cell.id]: {
              status: "queued",
              stdout: "",
              stderr: "",
              runId,
            },
          },
        }));
        runSources.current.set(runId, cell.source);
        const completion = new Promise<boolean>((resolve) => {
          pendingRuns.current.set(runId, resolve);
        });
        await executeShellNotebookCell(id, runId, cell.source);
        return completion;
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message);
        return false;
      }
    },
    [ensureSession, t],
  );

  const runAll = async () => {
    for (const cell of draft.cells) {
      if (!(await runCell(cell))) break;
    }
  };

  const stop = async () => {
    const id = sessionIdRef.current;
    if (!id) return;
    try {
      const info = await stopShellNotebook(id);
      setRuntime((previous) => ({
        ...previous,
        currentDirectory: info.currentDirectory,
        sessionStatus: "ready",
        cells: Object.fromEntries(
          Object.entries(previous.cells).map(([cellId, cell]) => [
            cellId,
            { ...cell, executionCount: undefined },
          ]),
        ),
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const restart = async (directory = draft.startDirectory) => {
    try {
      const id = await ensureSession();
      const info = await restartShellNotebook(id, { startDirectory: directory });
      setRuntime((previous) => ({
        ...previous,
        currentDirectory: info.currentDirectory,
        sessionStatus: "ready",
        cells: Object.fromEntries(
          Object.entries(previous.cells).map(([cellId, cell]) => [
            cellId,
            { ...cell, executionCount: undefined },
          ]),
        ),
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const pickDirectory = async () => {
    if (!isTauri()) {
      setError(t("shell_notebook_desktop_only"));
      return;
    }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true, multiple: false });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path || path === draft.startDirectory) return;
    if (Object.values(runtime.cells).some((cell) => cell.executionCount)) {
      setPendingDirectory(path);
      return;
    }
    setDraft((previous) => ({ ...previous, startDirectory: path }));
    await restart(path);
  };

  const exportMarkdown = async () => {
    if (!isTauri()) {
      setError(t("shell_notebook_desktop_only"));
      return;
    }
    const { save } = await import("@tauri-apps/plugin-dialog");
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const path = await save({
      defaultPath: `shell-notebook-${stamp}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!path) return;
    try {
      await exportShellNotebookMarkdown(path, buildShellNotebookMarkdown(draft.cells));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const updateCell = (id: string, source: string) => {
    setDraft((previous) => ({
      ...previous,
      cells: previous.cells.map((cell) => (cell.id === id ? { ...cell, source } : cell)),
    }));
  };

  const moveCell = (id: string, offset: -1 | 1) => {
    setDraft((previous) => {
      const index = previous.cells.findIndex((cell) => cell.id === id);
      const destination = index + offset;
      if (index < 0 || destination < 0 || destination >= previous.cells.length) return previous;
      const cells = [...previous.cells];
      const [cell] = cells.splice(index, 1);
      cells.splice(destination, 0, cell);
      return { ...previous, cells };
    });
  };

  const deleteCell = (id: string) => {
    setDraft((previous) => ({
      ...previous,
      cells: previous.cells.length === 1
        ? [newCell()]
        : previous.cells.filter((cell) => cell.id !== id),
    }));
  };

  const running = Object.values(runtime.cells).some((cell) => cell.status === "running" || cell.status === "queued");
  const desktopOnly = !isTauri();

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 overflow-auto pb-3"
      data-session-id={sessionId ?? undefined}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
        <div className="flex min-w-[220px] flex-1 items-center gap-2 text-label-13 text-muted-foreground">
          <Terminal className="h-4 w-4 shrink-0" />
          <span className="truncate">
            {runtime.currentDirectory || draft.startDirectory || t("shell_notebook_home_directory")}
          </span>
          <span className={cn(
            "rounded-sm border px-1.5 py-0.5 text-label-12",
            runtime.sessionStatus === "lost" ? "border-destructive/40 text-destructive" : "border-border",
          )}>
            {t(`shell_notebook_session_${runtime.sessionStatus}`)}
          </span>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void pickDirectory()}>
          <FolderOpen className="h-3.5 w-3.5" />
          {t("shell_notebook_directory")}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void runAll()} disabled={running || desktopOnly}>
          <Play className="h-3.5 w-3.5" />
          {t("shell_notebook_run_all")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void restart()} disabled={desktopOnly}>
          <RotateCcw className="h-3.5 w-3.5" />
          {t("shell_notebook_restart")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void exportMarkdown()}>
          <Download className="h-3.5 w-3.5" />
          {t("shell_notebook_export")}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title={t("shell_notebook_clear_workspace")}
          aria-label={t("shell_notebook_clear_workspace")}
          onClick={() => setDraft(newDraft())}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {desktopOnly && (
        <p className="text-label-13 text-muted-foreground">{t("shell_notebook_desktop_only")}</p>
      )}
      <p className="text-label-13 text-muted-foreground">{t("shell_notebook_clean_bash_hint")}</p>
      {error && <p className="text-label-13 text-destructive">{error}</p>}

      <div className="flex min-h-0 flex-col gap-3">
        {draft.cells.map((cell, index) => {
          const cellRuntime = runtime.cells[cell.id] ?? {
            status: "idle" as const,
            stdout: "",
            stderr: "",
          };
          const stale = cellRuntime.executedSourceHash != null
            && cellRuntime.executedSourceHash !== cell.source;
          const isRunning = cellRuntime.status === "running" || cellRuntime.status === "queued";
          return (
            <section key={cell.id} className="border border-border bg-background">
              <div className="flex min-h-9 items-center gap-1 border-b border-border bg-secondary/30 px-2">
                <span className="min-w-8 font-mono text-label-12 text-muted-foreground">{index + 1}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={t("shell_notebook_run_cell")}
                  aria-label={t("shell_notebook_run_cell")}
                  disabled={running || desktopOnly}
                  onClick={() => void runCell(cell)}
                >
                  <Play className="h-3.5 w-3.5" />
                </Button>
                {isRunning && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={t("shell_notebook_stop")}
                    aria-label={t("shell_notebook_stop")}
                    onClick={() => void stop()}
                  >
                    <Square className="h-3.5 w-3.5" />
                  </Button>
                )}
                <span className={cn(
                  "ml-1 text-label-12",
                  cellRuntime.status === "failed" || cellRuntime.status === "session-lost"
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}>
                  {stale ? t("shell_notebook_stale") : t(statusKey(cellRuntime.status))}
                  {cellRuntime.exitCode != null ? ` · ${cellRuntime.exitCode}` : ""}
                  {formatDuration(cellRuntime.durationMs) ? ` · ${formatDuration(cellRuntime.durationMs)}` : ""}
                </span>
                <div className="ml-auto flex items-center">
                  <Button variant="ghost" size="icon-sm" disabled={isRunning || index === 0} aria-label={t("shell_notebook_move_up")} title={t("shell_notebook_move_up")} onClick={() => moveCell(cell.id, -1)}>
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" disabled={isRunning || index === draft.cells.length - 1} aria-label={t("shell_notebook_move_down")} title={t("shell_notebook_move_down")} onClick={() => moveCell(cell.id, 1)}>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" disabled={isRunning} aria-label={t("shell_notebook_delete_cell")} title={t("shell_notebook_delete_cell")} onClick={() => deleteCell(cell.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <ShellCellEditor
                value={cell.source}
                disabled={isRunning}
                onChange={(source) => updateCell(cell.id, source)}
                onRun={() => void runCell(cell)}
              />
              {(cellRuntime.stdout || cellRuntime.stderr || cellRuntime.truncated) && (
                <div className="border-t border-border px-3 py-2 font-mono text-copy-13">
                  {cellRuntime.stdout && <pre className="whitespace-pre-wrap text-foreground">{stripAnsi(cellRuntime.stdout)}</pre>}
                  {cellRuntime.stderr && <pre className="mt-2 whitespace-pre-wrap text-destructive">{stripAnsi(cellRuntime.stderr)}</pre>}
                  {cellRuntime.truncated && <p className="mt-2 font-sans text-label-12 text-muted-foreground">{t("shell_notebook_output_truncated")}</p>}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <Button variant="secondary" size="sm" className="self-start" onClick={() => setDraft((previous) => ({ ...previous, cells: [...previous.cells, newCell()] }))}>
        <FilePlus2 className="h-3.5 w-3.5" />
        {t("shell_notebook_add_cell")}
      </Button>

      <ConfirmDialog
        open={pendingDirectory != null}
        onOpenChange={(open) => {
          if (!open) setPendingDirectory(null);
        }}
        title={t("shell_notebook_directory_restart_title")}
        description={t("shell_notebook_directory_restart_description")}
        confirmLabel={t("shell_notebook_restart")}
        onConfirm={() => {
          const directory = pendingDirectory;
          setPendingDirectory(null);
          if (!directory) return;
          setDraft((previous) => ({ ...previous, startDirectory: directory }));
          void restart(directory);
        }}
      />
    </div>
  );
}
