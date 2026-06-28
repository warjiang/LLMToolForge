/**
 * Frontend bridge for the local DataAgent preview server (see
 * `src-tauri/src/preview.rs`). Registers a generated app directory and returns
 * a `http://127.0.0.1:<port>/<token>/` URL that the embedded browser can open.
 * No-op outside the Tauri desktop runtime.
 */

import { isTauri } from "@/lib/utils";

export interface PreviewRegistration {
  url: string;
  token: string;
  port: number;
}

/** Register a directory with the preview server and return its localhost URL. */
export async function registerPreview(
  dir: string
): Promise<PreviewRegistration | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<PreviewRegistration>("preview_register", { req: { dir } });
}
