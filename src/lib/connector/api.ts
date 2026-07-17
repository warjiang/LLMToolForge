/**
 * Frontend bridge for the bundled OpenConnector runtime.
 *
 * The Rust supervisor (`connector::*` commands) owns the sidecar process and
 * hands us its port + admin token. This module wraps:
 *   - the supervisor lifecycle commands (start / stop / status), and
 *   - typed HTTP calls to the runtime's local API (provider catalog, credential
 *     connections, OAuth client config + authorization, action execution, run
 *     logs).
 *
 * Third-party credentials are never stored in the app; they live in the
 * runtime's own SQLite database behind the admin token. The runtime binds to
 * 127.0.0.1 only.
 *
 * In a plain browser (`pnpm dev`) the sidecar cannot run, so `supported` is
 * false and the UI degrades to an explanatory placeholder (same pattern as the
 * Unified API and MCP Inspector features).
 */

import { httpFetch } from "@/lib/http";
import type { JsonSchema } from "@/lib/mcpInspector";

export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

// ---- Supervisor lifecycle (Tauri commands) ----

export interface ConnectorStatus {
  running: boolean;
  port: number;
  adminToken: string;
  /** True when the app adopted an already-running runtime it did not spawn. */
  external: boolean;
}

async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function startRuntime(port?: number): Promise<ConnectorStatus> {
  return invoke<ConnectorStatus>("connector_start", { port: port ?? null });
}

export async function stopRuntime(): Promise<ConnectorStatus> {
  return invoke<ConnectorStatus>("connector_stop");
}

export async function getRuntimeStatus(): Promise<ConnectorStatus> {
  return invoke<ConnectorStatus>("connector_status");
}

/** Open a URL (OAuth authorization page or Web Console) in the system browser. */
export async function openUrl(url: string): Promise<void> {
  return invoke<void>("connector_open_url", { url });
}

// ---- Runtime HTTP API ----

export type AuthType =
  | "oauth2"
  | "api_key"
  | "custom_credential"
  | "no_auth"
  | string;

/** A single credential input field, as described by the runtime auth schema. */
export interface CredentialField {
  key: string;
  label: string;
  inputType: "text" | "password" | "textarea" | "json";
  required: boolean;
  secret: boolean;
  placeholder?: string;
  description?: string;
}

/** Auth definition for a provider, mirroring the runtime `/api/providers` schema. */
export type AuthDefinition =
  | { type: "no_auth" }
  | {
      type: "api_key";
      label?: string;
      placeholder?: string;
      description?: string;
      extraFields?: CredentialField[];
    }
  | { type: "custom_credential"; fields: CredentialField[] }
  | {
      type: "oauth2";
      scopes?: string[];
      authorizationUrl?: string;
      tokenUrl?: string;
      tokenEndpointAuthMethod?: string;
      clientConfigFields?: CredentialField[];
      [key: string]: unknown;
    };

/** OAuth2 config record shape returned by `/api/oauth/configs`. */
export interface ProviderAuthOAuth2 {
  type: "oauth2";
  authorizationUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  tokenEndpointAuthMethod?: string;
}

export type ProviderAuth = AuthDefinition;

/**
 * Resolve the concrete credential input fields for an auth definition, matching
 * the upstream web console. `api_key` yields a single password field plus any
 * extra fields; `custom_credential` uses its declared fields verbatim.
 */
export function credentialFieldsFor(auth: AuthDefinition): CredentialField[] {
  if (auth.type === "api_key") {
    return [
      {
        key: "apiKey",
        label: auth.label ?? "API key",
        inputType: "password",
        required: true,
        secret: true,
        placeholder: auth.placeholder,
        description: auth.description,
      },
      ...(auth.extraFields ?? []),
    ];
  }
  if (auth.type === "custom_credential") return auth.fields;
  return [];
}

export interface ProviderSummary {
  service: string;
  displayName: string;
  categories: string[];
  authTypes: AuthType[];
  homepageUrl?: string;
}

export interface ActionDefinition {
  id: string;
  service: string;
  name: string;
  description?: string;
  requiredScopes?: string[];
  providerPermissions?: string[];
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  execution?: {
    locallyExecutable: boolean;
    catalogOnly: boolean;
    requiredAuthTypes: AuthType[];
    noAuthRunnable: boolean;
    needsCredential: boolean;
  };
}

export interface ProviderDetail extends ProviderSummary {
  auth: ProviderAuth[];
  actions: ActionDefinition[];
}

export interface ActionSearchResult {
  id: string;
  service: string;
  name: string;
  description?: string;
  authenticated?: boolean;
  inputSchema?: JsonSchema;
}

export interface ConnectionRecord {
  id: string;
  service: string;
  connectionName: string;
  authType: AuthType;
  configured: boolean;
  virtual?: boolean;
  default?: boolean;
  profile?: {
    accountId?: string;
    displayName?: string;
    grantedScopes?: string[];
  };
}

export interface OAuthConfigRecord {
  service: string;
  configured: boolean;
  clientId: string | null;
  expectedRedirectUri: string;
  auth: ProviderAuthOAuth2;
}

export interface RunLogRecord {
  id?: string;
  executionId?: string;
  actionId?: string;
  service?: string;
  connectionName?: string;
  status?: string;
  ok?: boolean;
  errorCode?: string;
  durationMs?: number;
  createdAt?: string | number;
  [key: string]: unknown;
}

export interface ActionExecuteResult {
  ok: boolean;
  data?: unknown;
  errorCode?: string;
  message?: string;
  executionId?: string;
  raw: unknown;
}

/** Standard `/v1` success envelope. */
interface Envelope<T> {
  success: boolean;
  message?: string;
  data?: T;
  meta?: Record<string, unknown>;
  error?: { code?: string; message?: string };
}

interface RuntimeError {
  error: { code?: string; message?: string };
}

function baseUrl(status: ConnectorStatus): string {
  return `http://127.0.0.1:${status.port}`;
}

function authHeaders(status: ConnectorStatus): Record<string, string> {
  return status.adminToken
    ? { authorization: `Bearer ${status.adminToken}` }
    : {};
}

function isRuntimeError(value: unknown): value is RuntimeError {
  return Boolean(
    value &&
      typeof value === "object" &&
      "error" in value &&
      (value as RuntimeError).error
  );
}

async function parseJson(resp: Response): Promise<unknown> {
  const text = await resp.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Admin (`/api/*`) request. Responses are raw JSON (no success envelope). */
async function adminRequest<T>(
  status: ConnectorStatus,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const resp = await httpFetch(`${baseUrl(status)}${path}`, {
    method,
    headers: {
      ...authHeaders(status),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const parsed = await parseJson(resp);
  if (!resp.ok || isRuntimeError(parsed)) {
    const err = isRuntimeError(parsed) ? parsed.error : undefined;
    throw new Error(
      err?.message || `请求失败（${resp.status} ${path}）`
    );
  }
  return parsed as T;
}

export async function listProviders(
  status: ConnectorStatus
): Promise<ProviderSummary[]> {
  return adminRequest<ProviderSummary[]>(status, "GET", "/api/providers");
}

export async function getProvider(
  status: ConnectorStatus,
  service: string
): Promise<ProviderDetail> {
  return adminRequest<ProviderDetail>(
    status,
    "GET",
    `/api/providers/${encodeURIComponent(service)}`
  );
}

export async function searchActions(
  status: ConnectorStatus,
  query: string,
  limit = 20
): Promise<ActionSearchResult[]> {
  const q = encodeURIComponent(query);
  return adminRequest<ActionSearchResult[]>(
    status,
    "GET",
    `/api/actions/search?q=${q}&limit=${limit}`
  );
}

export async function getAction(
  status: ConnectorStatus,
  actionId: string
): Promise<ActionDefinition> {
  return adminRequest<ActionDefinition>(
    status,
    "GET",
    `/api/actions/${encodeURIComponent(actionId)}`
  );
}

export async function getActionGuide(
  status: ConnectorStatus,
  actionId: string
): Promise<string> {
  const resp = await httpFetch(
    `${baseUrl(status)}/api/actions/${encodeURIComponent(actionId)}/agent.md`,
    { headers: authHeaders(status) }
  );
  return resp.text();
}

export async function listConnections(
  status: ConnectorStatus
): Promise<ConnectionRecord[]> {
  return adminRequest<ConnectionRecord[]>(status, "GET", "/api/connections");
}

export async function putConnection(
  status: ConnectorStatus,
  service: string,
  authType: AuthType,
  values: Record<string, string>,
  connectionName?: string
): Promise<ConnectionRecord> {
  const body: Record<string, unknown> = { authType, values };
  if (connectionName) body.connectionName = connectionName;
  return adminRequest<ConnectionRecord>(
    status,
    "PUT",
    `/api/connections/${encodeURIComponent(service)}`,
    body
  );
}

export async function deleteConnection(
  status: ConnectorStatus,
  service: string
): Promise<void> {
  await adminRequest<unknown>(
    status,
    "DELETE",
    `/api/connections/${encodeURIComponent(service)}`
  );
}

export async function listOAuthConfigs(
  status: ConnectorStatus
): Promise<OAuthConfigRecord[]> {
  return adminRequest<OAuthConfigRecord[]>(status, "GET", "/api/oauth/configs");
}

export async function putOAuthConfig(
  status: ConnectorStatus,
  service: string,
  clientId: string,
  clientSecret: string,
  scopes?: string[]
): Promise<OAuthConfigRecord> {
  const body: Record<string, unknown> = { clientId, clientSecret };
  if (scopes && scopes.length) body.scopes = scopes;
  return adminRequest<OAuthConfigRecord>(
    status,
    "PUT",
    `/api/oauth/configs/${encodeURIComponent(service)}`,
    body
  );
}

export async function deleteOAuthConfig(
  status: ConnectorStatus,
  service: string
): Promise<void> {
  await adminRequest<unknown>(
    status,
    "DELETE",
    `/api/oauth/configs/${encodeURIComponent(service)}`
  );
}

/**
 * Begin an OAuth2 authorization. Returns the provider authorization URL the
 * user must open in a browser; the runtime's local `/oauth/callback` receives
 * the grant.
 */
export async function startOAuthAuthorization(
  status: ConnectorStatus,
  service: string,
  connectionName?: string
): Promise<{ authorizationUrl: string; state?: string }> {
  const body: Record<string, unknown> = { service };
  if (connectionName) body.connectionName = connectionName;
  const res = await adminRequest<{
    authorizationUrl?: string;
    url?: string;
    state?: string;
  }>(status, "POST", "/api/oauth/authorizations", body);
  const authorizationUrl = res.authorizationUrl || res.url || "";
  return { authorizationUrl, state: res.state };
}

export async function listRuns(
  status: ConnectorStatus,
  limit = 50
): Promise<RunLogRecord[]> {
  const res = await adminRequest<{ items?: RunLogRecord[] } | RunLogRecord[]>(
    status,
    "GET",
    `/api/runs?limit=${limit}`
  );
  if (Array.isArray(res)) return res;
  return res.items ?? [];
}

/**
 * Execute an Action against the `/v1` runtime endpoint. Uses the standard
 * success envelope; a completed Action failure still returns HTTP 200 with
 * `success:false`, which we surface as `ok:false`.
 */
export async function executeAction(
  status: ConnectorStatus,
  actionId: string,
  input: unknown,
  alias?: string
): Promise<ActionExecuteResult> {
  const headers: Record<string, string> = {
    ...authHeaders(status),
    "content-type": "application/json",
  };
  if (alias) headers["x-oo-connector-alias"] = alias;

  const resp = await httpFetch(
    `${baseUrl(status)}/v1/actions/${encodeURIComponent(actionId)}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ input: input ?? {} }),
    }
  );
  const parsed = (await parseJson(resp)) as Envelope<unknown> | undefined;
  const ok = Boolean(parsed?.success);
  return {
    ok,
    data: parsed?.data,
    errorCode: ok ? undefined : parsed?.error?.code,
    message: parsed?.message ?? parsed?.error?.message,
    executionId:
      (parsed?.meta as { executionId?: string } | undefined)?.executionId,
    raw: parsed,
  };
}

/** URL of the runtime's built-in Web Console (admin token required). */
export function consoleUrl(status: ConnectorStatus): string {
  return baseUrl(status);
}
