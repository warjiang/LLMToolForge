/**
 * Frontend bridge to the Rust SSH backend.
 *
 * Responsibilities:
 *  - seal/open credential fields through the OS-keychain-backed vault so the
 *    store file never holds plaintext secrets;
 *  - parse `~/.ssh/config` for one-click import (keys come back already read);
 *  - drive interactive terminal sessions over a Tauri IPC Channel;
 *  - export/import a portable, passphrase-encrypted `.ltfvault` file.
 *
 * Everything here is desktop-only; in the browser dev build the calls throw a
 * clear DesktopOnlyError so the UI can degrade gracefully.
 */

import { isTauri } from "@/lib/utils";
import type { SshHost } from "@/types";

export class DesktopOnlyError extends Error {
  constructor() {
    super("SSH features are only available in the desktop app.");
    this.name = "DesktopOnlyError";
  }
}

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new DesktopOnlyError();
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

/** Sensitive fields that are stored encrypted and decrypted just-in-time. */
const SECRET_FIELDS = ["password", "privateKey", "passphrase"] as const;
type SecretField = (typeof SECRET_FIELDS)[number];

/** Seal one plaintext value into an `enc:v1:` envelope. */
export function seal(value: string): Promise<string> {
  return invoke<string>("ssh_seal", { value });
}

/** Open (decrypt) one `enc:v1:` envelope. */
export function open(value: string): Promise<string> {
  return invoke<string>("ssh_open", { value });
}

/** Encrypt the secret fields of a host payload prior to persisting it. */
export async function sealHostSecrets<
  T extends Partial<Record<SecretField, string | undefined>>
>(input: T): Promise<T> {
  const out = { ...input };
  for (const field of SECRET_FIELDS) {
    const value = out[field];
    if (typeof value === "string" && value.length > 0) {
      out[field] = (await seal(value)) as T[SecretField];
    }
  }
  return out;
}

/** Decrypt a host's secret fields for use (e.g. connecting or editing). */
export async function openHostSecrets(host: SshHost): Promise<{
  password?: string;
  privateKey?: string;
  passphrase?: string;
}> {
  const result: { password?: string; privateKey?: string; passphrase?: string } = {};
  for (const field of SECRET_FIELDS) {
    const value = host[field];
    if (typeof value === "string" && value.length > 0) {
      result[field] = await open(value);
    }
  }
  return result;
}

export interface SshConfigCandidate {
  name: string;
  hostname: string;
  port: number;
  username: string;
  proxyJump?: string;
  forwardAgent?: boolean;
  identityFile?: string;
  keyName?: string;
  privateKey?: string;
  extraOptions: Record<string, string>;
}

/** Parse the user's ssh config (or a custom path) into import candidates. */
export function parseSshConfig(path?: string): Promise<SshConfigCandidate[]> {
  return invoke<SshConfigCandidate[]>("ssh_parse_config", { path: path ?? null });
}

// --- Interactive terminal --------------------------------------------------

export interface SshConnectConfig {
  hostname: string;
  port: number;
  username: string;
  authMethod: "password" | "key" | "agent";
  password?: string;
  privateKey?: string;
  passphrase?: string;
  cols?: number;
  rows?: number;
}

export interface SshConnectResult {
  sessionId: string;
  fingerprint?: string;
}

export type SshEvent =
  | { type: "data"; data: string }
  | { type: "closed"; code?: number }
  | { type: "error"; message: string };

/**
 * Open a terminal session. `onEvent` receives base64-data / closed / error
 * events streamed from the remote shell. Returns the session id used by the
 * write/resize/disconnect calls.
 */
export async function connect(
  config: SshConnectConfig,
  onEvent: (event: SshEvent) => void
): Promise<SshConnectResult> {
  if (!isTauri()) throw new DesktopOnlyError();
  const { invoke: tauriInvoke, Channel } = await import("@tauri-apps/api/core");
  const channel = new Channel<SshEvent>();
  channel.onmessage = onEvent;
  return tauriInvoke<SshConnectResult>("ssh_connect", { config, onEvent: channel });
}

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Send user keystrokes (UTF-8 string) to the remote shell. */
export function write(sessionId: string, data: string): Promise<void> {
  return invoke<void>("ssh_write", { sessionId, data: toBase64(encoder.encode(data)) });
}

/** Notify the remote shell of a terminal resize. */
export function resize(sessionId: string, cols: number, rows: number): Promise<void> {
  return invoke<void>("ssh_resize", { sessionId, cols, rows });
}

/** Tear down a terminal session. */
export function disconnect(sessionId: string): Promise<void> {
  return invoke<void>("ssh_disconnect", { sessionId });
}

// --- Portable vault export / import ----------------------------------------

/**
 * Export the given (already-decrypted) hosts to a passphrase-encrypted
 * `.ltfvault` file chosen via a save dialog. Returns false if cancelled.
 */
export async function exportVault(
  plaintextJson: string,
  passphrase: string
): Promise<boolean> {
  if (!isTauri()) throw new DesktopOnlyError();
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({
    defaultPath: "ssh-hosts.ltfvault",
    filters: [{ name: "LLMToolForge Vault", extensions: ["ltfvault"] }],
  });
  if (!path) return false;
  await invoke<void>("ssh_vault_export", { path, passphrase, plaintextJson });
  return true;
}

/**
 * Pick a `.ltfvault` file and decrypt it with `passphrase`, returning the
 * plaintext JSON, or null if cancelled.
 */
export async function importVault(passphrase: string): Promise<string | null> {
  if (!isTauri()) throw new DesktopOnlyError();
  const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
  const selected = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: "LLMToolForge Vault", extensions: ["ltfvault"] }],
  });
  const path = Array.isArray(selected) ? selected[0] : selected;
  if (!path) return null;
  return invoke<string>("ssh_vault_import", { path, passphrase });
}
