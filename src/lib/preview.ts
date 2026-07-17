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

export type PreviewMediaKind = "image" | "video" | "audio" | "pdf";

const MEDIA_EXT_KIND: Array<{ exts: RegExp; kind: PreviewMediaKind }> = [
  { exts: /\.(png|jpe?g|webp|gif|bmp|svg)$/i, kind: "image" },
  { exts: /\.(mp4|mov|webm|m4v|mpeg|mpg)$/i, kind: "video" },
  { exts: /\.(mp3|wav|ogg|m4a|aac|flac)$/i, kind: "audio" },
  { exts: /\.pdf$/i, kind: "pdf" },
];

/** Register a directory with the preview server and return its localhost URL. */
export async function registerPreview(
  dir: string
): Promise<PreviewRegistration | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<PreviewRegistration>("preview_register", { req: { dir } });
}

/** Detect preview kind from a file path by extension. */
export function mediaKindForPath(path: string): PreviewMediaKind | null {
  const clean = (path ?? "").split(/[?#]/)[0];
  for (const { exts, kind } of MEDIA_EXT_KIND) {
    if (exts.test(clean)) return kind;
  }
  return null;
}

/**
 * Register a file's parent directory and return a viewer URL that renders the
 * media through preview.rs `__view`.
 */
export async function registerPreviewMedia(filePath: string): Promise<string | null> {
  const kind = mediaKindForPath(filePath);
  if (!kind) return null;
  const normalized = filePath.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0 || slash >= normalized.length - 1) return null;
  const dir = normalized.slice(0, slash);
  const file = normalized.slice(slash + 1);
  const reg = await registerPreview(dir);
  if (!reg) return null;
  return `${reg.url}__view?f=${encodeURIComponent(file)}&kind=${kind}`;
}
