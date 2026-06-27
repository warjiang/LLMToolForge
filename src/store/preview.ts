import { create } from "zustand";

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
  nonce: number;
  openPreview: (url: string, title?: string) => void;
  closePreview: () => void;
}

export const usePreviewStore = create<PreviewState>((set) => ({
  open: false,
  url: null,
  title: null,
  nonce: 0,
  openPreview: (url, title) =>
    set((s) => ({ open: true, url, title: title ?? null, nonce: s.nonce + 1 })),
  closePreview: () => set({ open: false }),
}));
