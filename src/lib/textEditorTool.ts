import { isTauri } from "@/lib/utils";

export interface TextSearchMatch {
  index: number;
  length: number;
  line: number;
  column: number;
}

export interface TextStats {
  characters: number;
  lines: number;
}

export interface OpenedTextFile {
  path: string;
  name: string;
  content: string;
}

class DesktopOnlyError extends Error {
  constructor() {
    super("Text file opening is only available in the desktop app.");
    this.name = "DesktopOnlyError";
  }
}

const TEXT_FILE_EXTENSIONS = [
  "txt",
  "log",
  "md",
  "markdown",
  "json",
  "jsonl",
  "yaml",
  "yml",
  "toml",
  "xml",
  "csv",
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "rs",
  "go",
  "java",
  "kt",
  "swift",
  "c",
  "cpp",
  "h",
  "hpp",
  "css",
  "scss",
  "html",
  "sh",
  "zsh",
  "sql",
];

function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new DesktopOnlyError();
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

export function findTextMatches(text: string, query: string): TextSearchMatch[] {
  const needle = query.trim();
  if (!needle) return [];

  const haystack = text.toLocaleLowerCase();
  const normalizedNeedle = needle.toLocaleLowerCase();
  const matches: TextSearchMatch[] = [];
  let searchFrom = 0;

  while (searchFrom <= haystack.length) {
    const index = haystack.indexOf(normalizedNeedle, searchFrom);
    if (index === -1) break;
    const before = text.slice(0, index);
    const lineBreaks = before.match(/\n/g)?.length ?? 0;
    const lineStart = before.lastIndexOf("\n");
    matches.push({
      index,
      length: needle.length,
      line: lineBreaks + 1,
      column: index - lineStart,
    });
    searchFrom = index + normalizedNeedle.length;
  }

  return matches;
}

export function getTextStats(text: string): TextStats {
  return {
    characters: text.length,
    lines: text.length === 0 ? 0 : text.split("\n").length,
  };
}

export async function openLocalTextFile(): Promise<OpenedTextFile | null> {
  if (!isTauri()) throw new DesktopOnlyError();
  const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
  const selected = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: "Text and code", extensions: TEXT_FILE_EXTENSIONS }],
  });
  const path = Array.isArray(selected) ? selected[0] : selected;
  if (!path) return null;
  const content = await invoke<string>("text_file_open", { path });
  return {
    path,
    name: getFileName(path),
    content,
  };
}
