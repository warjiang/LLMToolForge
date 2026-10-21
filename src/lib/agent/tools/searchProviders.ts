import { httpFetch } from "@/lib/http";
import {
  FETCH_DETAILS_HARD_LIMIT,
  FETCH_LINKS_BUDGET,
  PROVIDER_ERROR_BODY_LIMIT,
  SEARCH_DETAILS_HARD_LIMIT,
  SEARCH_LIMIT_MAX,
  WEB_PROVIDER_CATALOG,
  clampFetchBodyChars,
  clampSearchResultCount,
  normalizeProviderOrder,
  serializedDetailsLength,
  truncateUnicode,
  type ProviderId,
} from "./webProviderCatalog";
import { invoke as tauriInvoke } from "./shared";

export type ProviderOperation = "search" | "fetch";

export interface WebSearchItem {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchItem[];
}

export interface WebFetchLink {
  text: string;
  href: string;
}

export interface WebFetchResponse {
  url: string;
  finalUrl: string;
  status: number;
  title: string;
  text: string;
  links: WebFetchLink[];
  truncated: boolean;
  mode: string;
}

export interface ProviderConfig {
  providerOrder: readonly unknown[];
  credentials: Readonly<Record<string, string | undefined>>;
}

export interface SearchRequest {
  query: string;
  limit: number;
  credentials?: Readonly<Record<string, string | undefined>>;
  signal: AbortSignal;
}

export interface FetchRequest {
  url: string;
  render?: boolean;
  maxChars?: number;
  timeoutMs?: number;
  credentials?: Readonly<Record<string, string | undefined>>;
  signal: AbortSignal;
}

export interface ProviderAdapter {
  id: ProviderId;
  search?: (request: SearchRequest) => Promise<WebSearchResponse>;
  fetch?: (request: FetchRequest) => Promise<WebFetchResponse>;
}

export type ProviderAdapterRegistry = Record<ProviderId, ProviderAdapter>;
export type HttpTransport = (
  input: string,
  init?: RequestInit
) => Promise<Response>;
export type LocalInvoke = <T>(
  command: string,
  args: Record<string, unknown>
) => Promise<T>;

export interface ProviderAdapterDependencies {
  transport?: HttpTransport;
  invoke?: LocalInvoke;
}

export const SEARCH_PROVIDER_TIMEOUT_MS = 15_000;
export const FETCH_PROVIDER_TIMEOUT_DEFAULT_MS = 20_000;
export const FETCH_PROVIDER_TIMEOUT_MIN_MS = 1_000;
export const FETCH_PROVIDER_TIMEOUT_MAX_MS = 60_000;

const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1/tools";
const TAVILY_BASE_URL = "https://api.tavily.com";

export class ProviderHttpError extends Error {
  readonly provider: ProviderId;
  readonly status: number;
  readonly diagnostic: string;

  constructor(provider: ProviderId, status: number, diagnostic = "") {
    const bounded = truncateUnicode(diagnostic, PROVIDER_ERROR_BODY_LIMIT);
    super(
      bounded
        ? `Web provider ${provider} returned HTTP ${status}: ${bounded}`
        : `Web provider ${provider} returned HTTP ${status}`
    );
    this.name = "ProviderHttpError";
    this.provider = provider;
    this.status = status;
    this.diagnostic = bounded;
  }
}

export class ProviderPayloadError extends Error {
  readonly provider: ProviderId;

  constructor(provider: ProviderId, message: string) {
    super(
      `Web provider ${provider} returned an invalid response: ${truncateUnicode(
        message,
        PROVIDER_ERROR_BODY_LIMIT
      )}`
    );
    this.name = "ProviderPayloadError";
    this.provider = provider;
  }
}

export class ProviderTimeoutError extends Error {
  readonly provider: ProviderId;
  readonly timeoutMs: number;

  constructor(provider: ProviderId, timeoutMs: number) {
    super(`Web provider ${provider} timed out after ${timeoutMs}ms`);
    this.name = "ProviderTimeoutError";
    this.provider = provider;
    this.timeoutMs = timeoutMs;
  }
}

export function resolveChain(
  operation: ProviderOperation,
  config: ProviderConfig,
  options: { render?: boolean } = {}
): ProviderId[] {
  const providers = normalizeProviderOrder(config.providerOrder);

  return providers.filter((id) => {
    const provider = WEB_PROVIDER_CATALOG.find((entry) => entry.id === id);
    if (!provider || !provider.capabilities.includes(operation)) return false;
    if (options.render && !provider.supportsRender) {
      return false;
    }
    return provider.requiredEnv.every(({ key }) =>
      isNonBlank(config.credentials[key])
    );
  });
}

interface AttemptContext {
  signal: AbortSignal;
  timeoutMs: number;
}

export interface RunChainOptions<T> {
  chain: readonly ProviderId[];
  operation: ProviderOperation;
  signal?: AbortSignal;
  timeoutMs?: number;
  attempt: (provider: ProviderId, context: AttemptContext) => Promise<T>;
  isSoftMiss: (result: T) => boolean;
}

export async function runChain<T>(options: RunChainOptions<T>): Promise<T> {
  let lastError: unknown;
  let lastSoftMiss: T | undefined;
  const timeoutMs = providerDeadline(options.operation, options.timeoutMs);

  for (const provider of options.chain) {
    throwIfAborted(options.signal);

    const controller = new AbortController();
    let timedOut = false;
    let callerAborted = false;
    const onCallerAbort = () => {
      callerAborted = true;
      controller.abort();
    };
    options.signal?.addEventListener("abort", onCallerAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const result = await awaitWithAbort(
        options.attempt(provider, {
          signal: controller.signal,
          timeoutMs,
        }),
        controller.signal
      );
      throwIfAborted(options.signal);
      if (!options.isSoftMiss(result)) return result;
      lastSoftMiss = result;
    } catch (error) {
      if (callerAborted || options.signal?.aborted) throw abortError();
      lastError = timedOut
        ? new ProviderTimeoutError(provider, timeoutMs)
        : error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onCallerAbort);
    }
  }

  if (lastSoftMiss !== undefined) return lastSoftMiss;
  throw lastError ?? new Error("No Web provider is available");
}

export function isSearchSoftMiss(response: WebSearchResponse): boolean {
  return response.results.length === 0;
}

export function isFetchSoftMiss(response: WebFetchResponse): boolean {
  return response.text.trim().length === 0;
}

export function createProviderAdapters(
  dependencies: ProviderAdapterDependencies = {}
): ProviderAdapterRegistry {
  const transport = dependencies.transport ?? httpFetch;
  const localInvoke = dependencies.invoke ?? tauriInvoke;

  return {
    local: {
      id: "local",
      search: async (request) => {
        const credentials = request.credentials ?? {};
        try {
          const response = await localInvoke<WebSearchResponse>("web_search", {
            req: { query: request.query, limit: request.limit },
          });
          return redactSearchResponse(response, credentials);
        } catch (error) {
          throw localInvocationError(error, credentials);
        }
      },
      fetch: async (request) => {
        const credentials = request.credentials ?? {};
        try {
          const response = await localInvoke<WebFetchResponse>("web_fetch", {
            req: {
              url: request.url,
              render: request.render ?? false,
              maxChars: clampFetchBodyChars(request.maxChars),
              timeoutMs: request.timeoutMs,
            },
          });
          return redactFetchResponse(response, credentials, request.maxChars);
        } catch (error) {
          throw localInvocationError(error, credentials);
        }
      },
    },
    deepseek: {
      id: "deepseek",
      search: async (request) => {
        const credentials = request.credentials ?? {};
        const response = await postJson(
          transport,
          "deepseek",
          `${DEEPSEEK_BASE_URL}/search`,
          {
            query: request.query,
            count: clampSearchResultCount(request.limit),
            need_content: false,
          },
          requiredCredential(credentials, "DEEPSEEK_API_KEY", "deepseek"),
          credentials,
          request.signal
        );
        const payload = await decodeJson("deepseek", response, credentials);
        if (!isRecord(payload) || !Array.isArray(payload.results)) {
          throw new ProviderPayloadError("deepseek", "missing results array");
        }

        return redactSearchResponse({
          query: request.query,
          results: payload.results.flatMap((item) => {
            if (!isRecord(item)) return [];
            const url = stringValue(item.url);
            if (!url) return [];
            return [{
              title: stringValue(item.title) || url,
              url,
              snippet: stringValue(item.summary) || stringValue(item.snippet),
            }];
          }),
        }, credentials);
      },
      fetch: async (request) => {
        const credentials = request.credentials ?? {};
        const response = await postJson(
          transport,
          "deepseek",
          `${DEEPSEEK_BASE_URL}/fetch`,
          { url: request.url },
          requiredCredential(credentials, "DEEPSEEK_API_KEY", "deepseek"),
          credentials,
          request.signal
        );
        const payload = await decodeJson("deepseek", response, credentials);
        if (!isRecord(payload) || typeof payload.content !== "string") {
          throw new ProviderPayloadError("deepseek", "missing content string");
        }

        return redactFetchResponse({
          url: request.url,
          finalUrl: request.url,
          status: 200,
          title: stringValue(payload.title),
          text: payload.content,
          links: [],
          truncated: false,
          mode: "deepseek",
        }, credentials, request.maxChars);
      },
    },
    tavily: {
      id: "tavily",
      search: async (request) => {
        const credentials = request.credentials ?? {};
        const response = await postJson(
          transport,
          "tavily",
          `${TAVILY_BASE_URL}/search`,
          {
            query: request.query,
            search_depth: "basic",
            max_results: clampSearchResultCount(request.limit),
            chunks_per_source: 1,
            include_raw_content: false,
          },
          requiredCredential(credentials, "TAVILY_API_KEY", "tavily"),
          credentials,
          request.signal
        );
        const payload = await decodeJson("tavily", response, credentials);
        if (!isRecord(payload) || !Array.isArray(payload.results)) {
          throw new ProviderPayloadError("tavily", "missing results array");
        }

        return redactSearchResponse({
          query: request.query,
          results: payload.results.flatMap((item) => {
            if (!isRecord(item)) return [];
            const url = stringValue(item.url);
            if (!url) return [];
            return [{
              title: stringValue(item.title) || url,
              url,
              snippet: stringValue(item.content),
            }];
          }),
        }, credentials);
      },
      fetch: async (request) => {
        const credentials = request.credentials ?? {};
        const response = await postJson(
          transport,
          "tavily",
          `${TAVILY_BASE_URL}/extract`,
          {
            urls: [request.url],
            format: "markdown",
            timeout: Math.ceil(
              providerDeadline("fetch", request.timeoutMs) / 1_000
            ),
          },
          requiredCredential(credentials, "TAVILY_API_KEY", "tavily"),
          credentials,
          request.signal
        );
        const payload = await decodeJson("tavily", response, credentials);
        if (!isRecord(payload)) {
          throw new ProviderPayloadError("tavily", "response is not an object");
        }
        if (
          Array.isArray(payload.failed_results) &&
          payload.failed_results.some(
            (item) => isRecord(item) && stringValue(item.url) === request.url
          )
        ) {
          throw new ProviderPayloadError(
            "tavily",
            "requested URL failed extraction"
          );
        }
        if (!Array.isArray(payload.results)) {
          throw new ProviderPayloadError("tavily", "missing results array");
        }
        const result = payload.results.find(
          (item) => isRecord(item) && stringValue(item.url) === request.url
        );
        if (result !== undefined && (!isRecord(result) || typeof result.raw_content !== "string")) {
          throw new ProviderPayloadError("tavily", "missing raw_content string");
        }

        return redactFetchResponse({
          url: request.url,
          finalUrl: request.url,
          status: 200,
          title: "",
          text: result && isRecord(result) ? result.raw_content as string : "",
          links: [],
          truncated: false,
          mode: "tavily",
        }, credentials, request.maxChars);
      },
    },
  };
}

export function normalizeSearchResponse(value: WebSearchResponse): WebSearchResponse {
  let query = truncateUnicode(value.query, 512);
  const results = value.results.slice(0, SEARCH_LIMIT_MAX).map((result) => ({
    title: truncateUnicode(result.title, 256),
    url: truncateUnicode(result.url, 512),
    snippet: truncateUnicode(result.snippet, 128),
  }));
  const normalized = { query, results };

  // The field caps above preserve the full 20-item contract within the details
  // ceiling. The final loop covers JSON escaping overhead from arbitrary input.
  while (serializedDetailsLength(normalized) > SEARCH_DETAILS_HARD_LIMIT) {
    const excess = serializedDetailsLength(normalized) - SEARCH_DETAILS_HARD_LIMIT;
    const candidate = normalized.results
      .slice()
      .reverse()
      .find(
        (item) =>
          item.snippet.length > 0 || item.title.length > 0 || item.url.length > 0
      );
    if (candidate) {
      if (candidate.snippet.length > 0) {
        candidate.snippet = shrinkForSerializedBudget(candidate.snippet, excess);
      } else if (candidate.title.length > 0) {
        candidate.title = shrinkForSerializedBudget(candidate.title, excess);
      } else {
        candidate.url = shrinkForSerializedBudget(candidate.url, excess);
      }
    } else if (query.length > 0) {
      query = shrinkForSerializedBudget(query, excess);
      normalized.query = query;
    } else {
      break;
    }
  }

  return normalized;
}

export function normalizeFetchResponse(
  value: WebFetchResponse,
  maxChars?: number
): WebFetchResponse {
  const bodyLimit = clampFetchBodyChars(maxChars);
  const bounded = boundedLinks(value.links);
  const url = truncateUnicode(value.url, 1_024);
  const finalUrl = truncateUnicode(value.finalUrl, 1_024);
  const title = truncateUnicode(value.title, 512);
  const text = truncateUnicode(value.text, bodyLimit);
  const mode = truncateUnicode(value.mode, 64);
  const normalized: WebFetchResponse = {
    url,
    finalUrl,
    status: Number.isFinite(value.status) ? Math.floor(value.status) : 0,
    title,
    text,
    links: bounded.links,
    truncated:
      value.truncated ||
      url !== value.url ||
      finalUrl !== value.finalUrl ||
      title !== value.title ||
      text !== value.text ||
      mode !== value.mode ||
      bounded.truncated,
    mode,
  };

  while (serializedDetailsLength(normalized) > FETCH_DETAILS_HARD_LIMIT) {
    if (normalized.text.length > 0) {
      normalized.text = shrinkForSerializedBudget(
        normalized.text,
        serializedDetailsLength(normalized) - FETCH_DETAILS_HARD_LIMIT
      );
      normalized.truncated = true;
      continue;
    }
    if (normalized.links.length > 0) {
      normalized.links.pop();
      normalized.truncated = true;
      continue;
    }
    break;
  }

  return normalized;
}

async function postJson(
  transport: HttpTransport,
  provider: ProviderId,
  url: string,
  body: unknown,
  apiKey: string,
  credentials: Readonly<Record<string, string | undefined>>,
  signal: AbortSignal
): Promise<Response> {
  try {
    return await transport(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (isAbortLike(error)) throw error;
    throw new ProviderPayloadError(
      provider,
      redactDiagnostic(error instanceof Error ? error.message : "request failed", credentials)
    );
  }
}

async function decodeJson(
  provider: ProviderId,
  response: Response,
  credentials: Readonly<Record<string, string | undefined>>
): Promise<unknown> {
  let raw: string;
  try {
    raw = await response.text();
  } catch {
    throw new ProviderPayloadError(provider, "could not read response body");
  }

  const diagnostic = redactDiagnostic(raw, credentials);
  if (!response.ok) {
    throw new ProviderHttpError(
      provider,
      response.status,
      httpDiagnostic(diagnostic, credentials)
    );
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ProviderPayloadError(provider, "invalid JSON");
  }
}

function boundedLinks(links: WebFetchLink[]): {
  links: WebFetchLink[];
  truncated: boolean;
} {
  const bounded: WebFetchLink[] = [];
  let truncated = links.length > 40;
  for (const link of links.slice(0, 40)) {
    const candidate = {
      text: truncateUnicode(link.text, 256),
      href: truncateUnicode(link.href, 512),
    };
    truncated ||= candidate.text !== link.text || candidate.href !== link.href;
    if (JSON.stringify([...bounded, candidate]).length > FETCH_LINKS_BUDGET) {
      truncated = true;
      break;
    }
    bounded.push(candidate);
  }
  return { links: bounded, truncated };
}

function shrinkForSerializedBudget(value: string, serializedExcess: number): string {
  const codePointLength = Array.from(value).length;
  return truncateUnicode(
    value,
    Math.max(0, codePointLength - Math.max(1, Math.ceil(serializedExcess / 2)))
  );
}

function requiredCredential(
  credentials: Readonly<Record<string, string | undefined>>,
  key: string,
  provider: ProviderId
): string {
  const value = credentials[key]?.trim();
  if (value) return value;
  throw new ProviderPayloadError(provider, `missing required credential ${key}`);
}

function providerDeadline(
  operation: ProviderOperation,
  timeoutMs: number | undefined
): number {
  if (operation === "search") return SEARCH_PROVIDER_TIMEOUT_MS;
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) {
    return FETCH_PROVIDER_TIMEOUT_DEFAULT_MS;
  }
  return Math.min(
    FETCH_PROVIDER_TIMEOUT_MAX_MS,
    Math.max(FETCH_PROVIDER_TIMEOUT_MIN_MS, Math.floor(timeoutMs))
  );
}

function httpDiagnostic(
  raw: string,
  credentials: Readonly<Record<string, string | undefined>>
): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return raw;
    const error = isRecord(parsed.error) ? parsed.error : parsed;
    const code = redactDiagnostic(stringValue(error.code), credentials);
    const message = redactDiagnostic(
      stringValue(error.message) || stringValue(error.detail),
      credentials
    );
    return [code, message].filter(Boolean).join(": ") || raw;
  } catch {
    return raw;
  }
}

function redactDiagnostic(
  value: string,
  credentials: Readonly<Record<string, string | undefined>>
): string {
  return truncateUnicode(
    redactCredentialValues(value, credentials),
    PROVIDER_ERROR_BODY_LIMIT
  );
}

function redactCredentialValues(
  value: string,
  credentials: Readonly<Record<string, string | undefined>>
): string {
  let redacted = value;
  for (const credential of Object.values(credentials)) {
    if (isNonBlank(credential)) {
      const normalizedCredential = credential.trim();
      for (const variant of credentialVariants(normalizedCredential)) {
        redacted = redacted.split(variant).join("[redacted]");
      }
      redacted = redactPercentEncodedCredential(
        redacted,
        normalizedCredential
      );
    }
  }
  return redacted;
}

function redactPercentEncodedCredential(value: string, credential: string): string {
  try {
    const percentEncoded = encodeURIComponent(credential);
    return [...new Set([
      percentEncoded,
      percentEncoded.replace(/%20/g, "+"),
    ])].reduce(
      (redacted, variant) =>
        variant === credential
          ? redacted
          : redacted.replace(
            new RegExp(escapeRegExp(variant), "gi"),
            "[redacted]"
          ),
      value
    );
  } catch {
    return value;
  }
}

function credentialVariants(credential: string): string[] {
  const variants = [
    credential,
    JSON.stringify(credential).slice(1, -1),
  ];

  try {
    const percentEncoded = encodeURIComponent(credential);
    variants.push(percentEncoded, percentEncoded.replace(/%20/g, "+"));
  } catch {
    // Preserve raw/JSON redaction when a malformed Unicode credential cannot
    // be URI-encoded.
  }

  return [...new Set(variants)];
}

function localInvocationError(
  error: unknown,
  credentials: Readonly<Record<string, string | undefined>>
): unknown {
  if (isAbortLike(error)) return error;
  return new ProviderPayloadError(
    "local",
    redactDiagnostic(
      error instanceof Error ? error.message : "local invocation failed",
      credentials
    )
  );
}

function redactSearchResponse(
  response: WebSearchResponse,
  credentials: Readonly<Record<string, string | undefined>>
): WebSearchResponse {
  return normalizeSearchResponse({
    query: redactCredentialValues(response.query, credentials),
    results: response.results.map((result) => ({
      title: redactCredentialValues(result.title, credentials),
      url: redactCredentialValues(result.url, credentials),
      snippet: redactCredentialValues(result.snippet, credentials),
    })),
  });
}

function redactFetchResponse(
  response: WebFetchResponse,
  credentials: Readonly<Record<string, string | undefined>>,
  maxChars?: number
): WebFetchResponse {
  return normalizeFetchResponse({
    url: redactCredentialValues(response.url, credentials),
    finalUrl: redactCredentialValues(response.finalUrl, credentials),
    status: response.status,
    title: redactCredentialValues(response.title, credentials),
    text: redactCredentialValues(response.text, credentials),
    links: response.links.map((link) => ({
      text: redactCredentialValues(link.text, credentials),
      href: redactCredentialValues(link.href, credentials),
    })),
    truncated: response.truncated,
    mode: redactCredentialValues(response.mode, credentials),
  }, clampFetchBodyChars(maxChars));
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function awaitWithAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (result) => {
        cleanup();
        resolve(result);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
}

function abortError(): DOMException {
  return new DOMException("Web provider request aborted", "AbortError");
}

function isAbortLike(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error &&
      (error.name === "AbortError" || error.message === "Request cancelled");
}

function isNonBlank(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
