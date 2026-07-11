/**
 * Export the report currently shown in the preview panel.
 *
 * The report is a page served by the local preview server (see
 * `src-tauri/src/preview.rs`) and rendered in a native child webview, so the
 * main DOM never holds its HTML. Both exports therefore go through Rust:
 *   - HTML: read the on-disk artifact, inline sibling assets + the bundled
 *     ECharts runtime, strip the live-reload poller, write a self-contained file.
 *   - PDF: write that same self-contained file to a temp dir and open it in the
 *     OS default browser, where the user can print to PDF. (The embedded macOS
 *     WKWebView silently ignores `window.print()`, so we can't print in place.)
 * All calls are no-ops outside the Tauri desktop runtime.
 */

import { isTauri } from "@/lib/utils";

/** Build a filesystem-safe default filename from the report title. */
function defaultHtmlName(title?: string | null): string {
  const base = (title ?? "").trim().replace(/[/\\?%*:|"<>]/g, "_").slice(0, 80);
  return `${base || "report"}.html`;
}

/**
 * Export the report to a self-contained HTML file chosen via a save dialog.
 * `outputDir` is the artifact directory tracked by the preview store; `file` is
 * the served page name (omit for `index.html`). Returns false if cancelled.
 */
export async function exportReportHtml(
  outputDir: string,
  title?: string | null,
  file?: string
): Promise<boolean> {
  if (!isTauri()) return false;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const targetPath = await save({
    defaultPath: defaultHtmlName(title),
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  if (!targetPath) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke<void>("report_export_html", {
    req: { outputDir, targetPath, file: file ?? null },
  });
  return true;
}

/**
 * Open the report in the OS default browser so the user can print it to PDF.
 * `outputDir` is the artifact directory tracked by the preview store.
 */
export async function exportReportPdf(
  outputDir: string,
  title?: string | null,
  file?: string
): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke<string>("report_open_in_browser", {
    req: { outputDir, title: title ?? null, file: file ?? null },
  });
}
