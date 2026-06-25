/**
 * Shared request helpers for OpenAI-compatible gateways (new-api / litellm).
 *
 * Centralizes Base URL / API Key validation so we fail with a clear, localized
 * message instead of a cryptic WebView `DOMException` (older WebKit surfaces an
 * invalid URL or header value as "The string did not match the expected
 * pattern."). It also joins the endpoint path safely and adds context when the
 * underlying transport throws.
 */

import { httpFetch } from "@/lib/http";
import type { ProviderCredential } from "@/lib/providers/types";
import i18n from "@/i18n/config";

/** Characters allowed in an HTTP header value (visible ASCII + space/tab). */
const INVALID_HEADER_VALUE = /[^\t\x20-\x7e\x80-\xff]/;

/**
 * Normalize and validate the Base URL. Returns it without a trailing slash.
 * Throws a localized error when missing or not a valid http(s) URL.
 */
export function normalizeBaseUrl(cred: ProviderCredential): string {
  const raw = (cred.baseUrl ?? "").trim();
  if (!raw) throw new Error(i18n.t("provider_missing_base_url", { ns: "common" }));

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      i18n.t("provider_invalid_base_url", { ns: "common", raw })
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      i18n.t("provider_unsupported_protocol", { ns: "common", protocol: parsed.protocol })
    );
  }
  return raw.replace(/\/+$/, "");
}

/**
 * Validate the API Key and return the `Authorization` header value. Rejects
 * keys containing characters that are illegal in an HTTP header value (e.g. a
 * stray newline or non-Latin1 character introduced when copy-pasting).
 */
export function authHeader(cred: ProviderCredential): string {
  const key = (cred.apiKey ?? "").trim();
  if (!key) throw new Error(i18n.t("provider_missing_api_key", { ns: "common" }));
  if (INVALID_HEADER_VALUE.test(key)) {
    throw new Error(
      i18n.t("provider_invalid_api_key_chars", { ns: "common" })
    );
  }
  return `Bearer ${key}`;
}

/** Join the validated Base URL with an endpoint path (e.g. "models"). */
export function endpoint(base: string, path: string): string {
  return `${base}/${path.replace(/^\/+/, "")}`;
}

/**
 * `httpFetch` wrapper that annotates transport-level failures with the target
 * URL so a cryptic WebView error becomes actionable.
 */
export async function gatewayFetch(
  url: string,
  init: RequestInit
): Promise<Response> {
  try {
    return await httpFetch(url, init);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(i18n.t("provider_request_failed", { ns: "common", url, detail }));
  }
}
