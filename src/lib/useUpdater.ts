import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

export type UpdaterPhase =
  | "idle"
  | "checking"
  | "available"
  | "uptodate"
  | "downloading"
  | "ready"
  | "error";

export interface UpdaterState {
  phase: UpdaterPhase;
  currentVersion: string;
  newVersion?: string;
  notes?: string;
  progress: number;
  error?: string;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Drives the Tauri updater flow: check -> notify -> download -> install -> relaunch.
 * `silent` controls whether an automatic background check runs on mount; the
 * returned `check`/`install`/`dismiss` actions power the manual Settings flow.
 */
export function useUpdater(options?: { auto?: boolean }) {
  const auto = options?.auto ?? false;
  const [state, setState] = useState<UpdaterState>({
    phase: "idle",
    currentVersion: "",
    progress: 0,
  });
  const updateRef = useRef<Update | null>(null);
  const ranAuto = useRef(false);

  useEffect(() => {
    if (!isTauri) return;
    // In dev the compiled Tauri version is the stale committed value (0.1.0),
    // so prefer the git-derived version injected at build time to reflect the
    // actual code state. Production keeps the real bundled version.
    if (import.meta.env.DEV && __GIT_APP_VERSION__) {
      setState((s) => ({ ...s, currentVersion: __GIT_APP_VERSION__ }));
      return;
    }
    getVersion()
      .then((v) => setState((s) => ({ ...s, currentVersion: v })))
      .catch(() => undefined);
  }, []);

  const runCheck = useCallback(async (manual = false) => {
    if (!isTauri) {
      if (manual) setState((s) => ({ ...s, phase: "uptodate" }));
      return;
    }
    setState((s) => ({ ...s, phase: "checking", error: undefined }));
    try {
      const update = await check();
      if (update) {
        updateRef.current = update;
        setState((s) => ({
          ...s,
          phase: "available",
          newVersion: update.version,
          notes: update.body || undefined,
        }));
      } else {
        setState((s) => ({ ...s, phase: "uptodate" }));
      }
    } catch (e) {
      setState((s) => ({
        ...s,
        phase: "error",
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  }, []);

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    setState((s) => ({ ...s, phase: "downloading", progress: 0 }));
    try {
      let downloaded = 0;
      let total = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
          setState((s) => ({ ...s, progress: pct }));
        } else if (event.event === "Finished") {
          setState((s) => ({ ...s, progress: 100 }));
        }
      });
      setState((s) => ({ ...s, phase: "ready" }));
      await relaunch();
    } catch (e) {
      setState((s) => ({
        ...s,
        phase: "error",
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  }, []);

  const dismiss = useCallback(() => {
    setState((s) => ({ ...s, phase: "idle" }));
  }, []);

  useEffect(() => {
    if (!auto || ranAuto.current) return;
    // Skip the silent startup check in the dev environment (`pnpm tauri:dev`),
    // where there is no signed bundle to update against.
    if (import.meta.env.DEV) return;
    ranAuto.current = true;
    void runCheck(false);
  }, [auto, runCheck]);

  return {
    state,
    check: () => runCheck(true),
    install,
    dismiss,
  };
}
