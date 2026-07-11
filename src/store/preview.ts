import { create } from "zustand";

const WIDTH_KEY = "llmtoolforge.preview.width";

export const PREVIEW_DEFAULT_WIDTH = 640;
export const PREVIEW_MIN_WIDTH = 400;
export const PREVIEW_MAX_WIDTH = 1100;

function clampWidth(width: number): number {
  return Math.min(PREVIEW_MAX_WIDTH, Math.max(PREVIEW_MIN_WIDTH, Math.round(width)));
}

function getInitialWidth(): number {
  if (typeof window === "undefined") return PREVIEW_DEFAULT_WIDTH;
  const raw = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(raw) && raw > 0 ? clampWidth(raw) : PREVIEW_DEFAULT_WIDTH;
}

/**
 * Drives the in-chat preview panel that hosts the embedded browser webview.
 * The DataAgent opens generated localhost apps here after a chart/report tool
 * finishes. `nonce` bumps on every open so the panel re-navigates even when the
 * URL is unchanged (e.g. regenerating into the same directory).
 */
interface PreviewState {
  open: boolean;
  url: string | null;
  title: string | null;
  /** Source artifact directory on disk, used to export the report to HTML. */
  outputDir: string | null;
  nonce: number;
  width: number;
  openPreview: (
    url: string,
    title?: string,
    outputDir?: string | null
  ) => void;
  closePreview: () => void;
  setWidth: (width: number) => void;
}

export const usePreviewStore = create<PreviewState>((set) => ({
  open: false,
  url: null,
  title: null,
  outputDir: null,
  nonce: 0,
  width: getInitialWidth(),
  openPreview: (url, title, outputDir) =>
    set((s) => ({
      open: true,
      url,
      title: title ?? null,
      outputDir: outputDir ?? null,
      nonce: s.nonce + 1,
    })),
  closePreview: () => set({ open: false }),
  setWidth: (width) => {
    const next = clampWidth(width);
    localStorage.setItem(WIDTH_KEY, String(next));
    set({ width: next });
  },
}));
