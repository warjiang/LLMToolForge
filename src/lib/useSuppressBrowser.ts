import { useEffect } from "react";
import { suppressBrowser } from "@/lib/browser";

/**
 * Hide the native embedded browser webview for as long as the calling component
 * is mounted, restoring it on unmount.
 *
 * The in-app browser is a native child webview that always renders above the
 * DOM, so CSS `z-index` cannot place modals/overlays in front of it. Calling
 * this hook from a portaled overlay's content (which only mounts while open)
 * keeps that overlay visible by suppressing the webview while it is shown.
 */
export function useSuppressBrowser(): void {
  useEffect(() => suppressBrowser(), []);
}
