/**
 * Frontend bridge for the in-app browser (native child webview).
 *
 * The webview itself is created and driven by the Rust side (see
 * `src-tauri/src/browser.rs`); this module only forwards commands and
 * subscribes to navigation / loading events. All calls are no-ops outside the
 * Tauri desktop runtime.
 */

import { isTauri } from "@/lib/utils";

export const BROWSER_NAVIGATED_EVENT = "browser://navigated";
export const BROWSER_LOADING_EVENT = "browser://loading";

/** Logical-pixel rectangle for positioning the embedded webview. */
export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserNavigated {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface BrowserStatus {
  exists: boolean;
  url: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Create the embedded webview (first call) or navigate it, then show + place. */
export async function openBrowser(
  url: string,
  bounds: BrowserBounds
): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>("browser_open", { url, ...bounds });
}

export async function navigateBrowser(url: string): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>("browser_navigate", { url });
}

export async function browserBack(): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>("browser_back");
}

export async function browserForward(): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>("browser_forward");
}

export async function browserReload(): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>("browser_reload");
}

export async function setBrowserBounds(bounds: BrowserBounds): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>("browser_set_bounds", {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  });
}

export async function showBrowser(): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>("browser_show");
}

export async function hideBrowser(): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>("browser_hide");
}

/**
 * Native-webview visibility manager.
 *
 * The embedded browser is a native child webview that always paints above the
 * DOM, so CSS `z-index` cannot place modals/overlays in front of it. To keep
 * dialogs visible we hide the webview whenever a modal overlay is open. The
 * webview is shown only when ALL of these hold:
 *   - `previewVisible`: a preview panel currently wants the browser shown.
 *   - `suppressionCount === 0`: no imperative suppressor (e.g. a panel resize
 *     drag) is active.
 *   - no Radix dialog/alert-dialog is mounted in the DOM.
 *
 * Overlay state is read directly from the DOM (not a counter) so it is
 * self-healing: if an overlay unmounts without a matching release, a later DOM
 * mutation recomputes visibility and restores the webview. Calls to the Rust
 * side are de-duped so streaming DOM churn does not spam show/hide.
 */
let previewVisible = false;
let suppressionCount = 0;
let lastApplied: boolean | null = null;
let overlayObserver: MutationObserver | null = null;

function overlayOpen(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector('[role="dialog"],[role="alertdialog"]') !== null;
}

function ensureOverlayObserver(): void {
  if (
    overlayObserver ||
    typeof document === "undefined" ||
    typeof MutationObserver === "undefined" ||
    !document.body
  ) {
    return;
  }
  overlayObserver = new MutationObserver(() => applyBrowserVisibility());
  overlayObserver.observe(document.body, { childList: true, subtree: true });
}

function applyBrowserVisibility(): void {
  const visible = previewVisible && suppressionCount === 0 && !overlayOpen();
  if (visible === lastApplied) return;
  lastApplied = visible;
  if (visible) void showBrowser();
  else void hideBrowser();
}

/** Declare whether a preview panel wants the native browser shown. */
export function setBrowserPreviewVisible(visible: boolean): void {
  previewVisible = visible;
  if (visible) {
    ensureOverlayObserver();
    // A fresh preview request supersedes any stale imperative suppression
    // (e.g. a resize drag whose release was missed), so the webview can never
    // get permanently stuck hidden.
    suppressionCount = 0;
  }
  applyBrowserVisibility();
}

/**
 * Suppress the native browser while an imperative gesture (e.g. a panel resize
 * drag) needs the webview out of the way. Returns a release callback. Dialogs
 * and other overlays do NOT need this — they are detected from the DOM.
 */
export function suppressBrowser(): () => void {
  suppressionCount += 1;
  applyBrowserVisibility();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    suppressionCount = Math.max(0, suppressionCount - 1);
    applyBrowserVisibility();
  };
}

export async function closeBrowser(): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>("browser_close");
}

export async function getBrowserStatus(): Promise<BrowserStatus> {
  if (!isTauri()) {
    return { exists: false, url: null, canGoBack: false, canGoForward: false };
  }
  return invoke<BrowserStatus>("browser_status");
}

export async function onBrowserNavigated(
  cb: (payload: BrowserNavigated) => void
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<BrowserNavigated>(BROWSER_NAVIGATED_EVENT, (e) => cb(e.payload));
}

export async function onBrowserLoading(
  cb: (loading: boolean) => void
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<{ loading: boolean }>(BROWSER_LOADING_EVENT, (e) =>
    cb(e.payload.loading)
  );
}
