import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The design system defines custom font-size utilities (text-heading-*,
// text-copy-*, text-label-*). tailwind-merge doesn't know these are font sizes,
// so by default it treats e.g. `text-label-14` as a text *color* and drops a
// real color class like `text-primary-foreground` that appears before it. That
// made primary buttons render dark-on-dark (invisible label + icon). Registering
// them in the font-size group keeps size and color classes from conflicting.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "heading-72",
            "heading-48",
            "heading-32",
            "heading-24",
            "heading-20",
            "heading-16",
            "heading-14",
            "copy-16",
            "copy-14",
            "copy-13",
            "label-14",
            "label-13",
            "label-12",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Remove ANSI escape sequences (color / style codes like `\x1b[2m`) from text.
 *
 * CLI-based MCP servers (e.g. Playwright) emit colorized output; without a
 * terminal to interpret them the raw codes leak into the UI as noise such as
 * `[2m ... [22m`. Strip them before displaying the text.
 */
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN =
  /[\u001B\u009B][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007|(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

export function formatDate(value: string | number | Date): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// Compact single-line stamp: 2026-06-26 21:14:05. Locale-stable, sortable, never wraps.
export function formatDateTime(value: string | number | Date): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

// Time-of-day only, for per-message stamps: 21:14.
export function formatTime(value: string | number | Date): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function maskSecret(secret: string, visible = 4): string {
  if (!secret) return "";
  if (secret.length <= visible) return "•".repeat(secret.length);
  return `${secret.slice(0, visible)}${"•".repeat(Math.min(12, secret.length - visible))}`;
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

export function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Mac|iPhone|iPad|iPod/.test(ua);
}
