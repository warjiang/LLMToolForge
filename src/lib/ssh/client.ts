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
import { useSyncStore } from "@/store/sync";
import type { EncryptionConfig } from "@/data/sync/types";
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

/**
 * The current sync encryption config, when the user has a sync passphrase set.
 *
 * Passing this to seal/open lets credentials be sealed with a passphrase-derived
 * key (portable `enc:v2:` envelope) instead of the device-local keychain key, so
 * they can be opened on every device that shares the sync passphrase. Returns
 * `null` when sync isn't configured, in which case the backend falls back to the
 * device-local `enc:v1:` envelope.
 */
function currentEncryption(): EncryptionConfig | null {
  const { passphrase, saltB64 } = useSyncStore.getState();
  if (passphrase && saltB64) return { passphrase, saltB64 };
  return null;
}

/** Seal one plaintext value into a sealed envelope (portable when synced). */
export function seal(value: string): Promise<string> {
  return invoke<string>("ssh_seal", { value, encryption: currentEncryption() });
}

/** Open (decrypt) one sealed envelope. */
export function open(value: string): Promise<string> {
  return invoke<string>("ssh_open", { value, encryption: currentEncryption() });
}

/** Whether a stored value is a legacy device-local (`enc:v1:`) envelope. */
export function isDeviceLocalSeal(value: string | undefined): boolean {
  return typeof value === "string" && value.startsWith("enc:v1:");
}

/**
 * Re-seal a legacy device-local value into a portable `enc:v2:` envelope so it
 * survives cross-device sync. Requires a configured sync passphrase.
 */
export function reseal(value: string): Promise<string> {
  const encryption = currentEncryption();
  if (!encryption) throw new Error("sync passphrase required to migrate credentials");
  return invoke<string>("ssh_reseal", { value, encryption });
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

/**
 * Migrate a host's legacy device-local (`enc:v1:`) secrets to portable
 * `enc:v2:` envelopes. Returns a patch with only the re-sealed fields, or `null`
 * when there's nothing to migrate (already portable, or no sync passphrase).
 *
 * This runs on the device that originally sealed the credentials (the only one
 * whose keychain can open `enc:v1:`), so a subsequent sync propagates openable
 * blobs to every other device.
 */
export async function migrateHostSecretsForSync(
  host: SshHost
): Promise<Partial<Record<SecretField, string>> | null> {
  if (!currentEncryption()) return null;
  const patch: Partial<Record<SecretField, string>> = {};
  let changed = false;
  for (const field of SECRET_FIELDS) {
    const value = host[field];
    if (isDeviceLocalSeal(value)) {
      patch[field] = await reseal(value as string);
      changed = true;
    }
  }
  return changed ? patch : null;
}

/**
 * Resolve a `ProxyJump` reference token to a managed host. The token is usually
 * a config alias (matched against `host.name`), but inline `user@host:port`
 * forms are tolerated too. Returns null when nothing matches.
 */
function findJumpHost(token: string, hosts: SshHost[]): SshHost | null {
  const trimmed = token.trim();
  if (!trimmed || trimmed.toLowerCase() === "none") return null;
  const byName = hosts.find((h) => h.name === trimmed);
  if (byName) return byName;

  // Fallback: parse `user@host:port` and match on hostname.
  let rest = trimmed;
  let user: string | undefined;
  const at = rest.lastIndexOf("@");
  if (at >= 0) {
    user = rest.slice(0, at);
    rest = rest.slice(at + 1);
  }
  const colon = rest.lastIndexOf(":");
  const hostname = colon >= 0 ? rest.slice(0, colon) : rest;
  return (
    hosts.find(
      (h) => h.hostname === hostname && (!user || h.username === user)
    ) ?? null
  );
}

async function hostToHop(host: SshHost): Promise<SshHop> {
  const secrets = await openHostSecrets(host);
  return {
    hostname: host.hostname,
    port: host.port,
    username: host.username,
    authMethod: host.authMethod,
    ...secrets,
  };
}

/**
 * Walk a host's `proxyJump` chain (which may itself reference jumped hosts),
 * decrypting each hop's credentials. Returns the ordered list of hops with the
 * outermost (first-dialed) jump first. Guards against cycles and missing hosts.
 */
async function resolveJumps(
  host: SshHost,
  hosts: SshHost[],
  seen: Set<string>
): Promise<SshHop[]> {
  if (!host.proxyJump) return [];
  const tokens = host.proxyJump
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const chain: SshHop[] = [];
  for (const token of tokens) {
    const jump = findJumpHost(token, hosts);
    if (!jump) {
      throw new Error(`ProxyJump host not found, import it first: ${token}`);
    }
    if (seen.has(jump.id)) {
      throw new Error(`ProxyJump cycle detected at: ${jump.name}`);
    }
    const nextSeen = new Set(seen).add(jump.id);
    // Any jumps the jump host itself needs come before it.
    const upstream = await resolveJumps(jump, hosts, nextSeen);
    chain.push(...upstream, await hostToHop(jump));
  }
  return chain;
}

/**
 * Build a fully-resolved, decrypted connect config for `host`, including its
 * ProxyJump chain (looked up among `hosts`). Use this instead of assembling the
 * config by hand so jumped/bastioned hosts connect correctly.
 */
export async function buildConnectConfig(
  host: SshHost,
  hosts: SshHost[],
  cols: number,
  rows: number
): Promise<SshConnectConfig> {
  const jumps = await resolveJumps(host, hosts, new Set([host.id]));
  const secrets = await openHostSecrets(host);
  return {
    hostname: host.hostname,
    port: host.port,
    username: host.username,
    authMethod: host.authMethod,
    ...secrets,
    jumps,
    cols,
    rows,
  };
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
  /** Ordered ProxyJump chain (outermost first); empty for a direct connect. */
  jumps?: SshHop[];
  cols?: number;
  rows?: number;
}

/** A single ProxyJump hop with decrypted credentials. */
export interface SshHop {
  hostname: string;
  port: number;
  username: string;
  authMethod: "password" | "key" | "agent";
  password?: string;
  privateKey?: string;
  passphrase?: string;
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
