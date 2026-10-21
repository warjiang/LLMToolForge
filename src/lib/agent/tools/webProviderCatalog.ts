export type ProviderId = "deepseek" | "tavily" | "local";
export type WebCapability = "search" | "fetch";
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface RequiredEnvMeta {
  key: string;
  labelKey: string;
}

export interface ProviderMeta {
  id: ProviderId;
  displayName: string;
  descriptionKey: string;
  capabilities: readonly WebCapability[];
  requiredEnv: readonly RequiredEnvMeta[];
  supportsRender: boolean;
}

export interface BuiltinWebConfig {
  providerOrder: ProviderId[];
  credentials: Record<string, string>;
}

export const WEB_PROVIDER_CATALOG: readonly ProviderMeta[] = [
  {
    id: "deepseek",
    displayName: "DeepSeek",
    descriptionKey: "builtin_web.provider.deepseek.description",
    capabilities: ["search", "fetch"],
    requiredEnv: [
      {
        key: "DEEPSEEK_API_KEY",
        labelKey: "builtin_web.provider.deepseek.api_key",
      },
    ],
    supportsRender: false,
  },
  {
    id: "tavily",
    displayName: "Tavily",
    descriptionKey: "builtin_web.provider.tavily.description",
    capabilities: ["search", "fetch"],
    requiredEnv: [
      {
        key: "TAVILY_API_KEY",
        labelKey: "builtin_web.provider.tavily.api_key",
      },
    ],
    supportsRender: false,
  },
  {
    id: "local",
    displayName: "Local",
    descriptionKey: "builtin_web.provider.local.description",
    capabilities: ["search", "fetch"],
    requiredEnv: [],
    supportsRender: true,
  },
];

export const BUILTIN_WEB_STORAGE_KEY = "llmtoolforge.builtin-web";

export const SEARCH_LIMIT_DEFAULT = 8;
export const SEARCH_LIMIT_MAX = 20;
export const SEARCH_TEXT_HARD_LIMIT = 20_000;
export const SEARCH_DETAILS_HARD_LIMIT = 20_000;
export const FETCH_BODY_DEFAULT = 40_000;
export const FETCH_BODY_HARD_LIMIT = 40_000;
export const FETCH_TEXT_HARD_LIMIT = 48_000;
export const FETCH_DETAILS_HARD_LIMIT = 48_000;
export const FETCH_LINKS_BUDGET = 6_000;
export const PROVIDER_ERROR_BODY_LIMIT = 4_096;

const LOCAL_PROVIDER_ID: ProviderId = "local";
const KNOWN_PROVIDER_IDS = new Set<ProviderId>(
  WEB_PROVIDER_CATALOG.map((provider) => provider.id)
);
const KNOWN_CREDENTIAL_KEYS = new Set(
  WEB_PROVIDER_CATALOG.flatMap((provider) =>
    provider.requiredEnv.map((requiredEnv) => requiredEnv.key)
  )
);

export const DEFAULT_BUILTIN_WEB_CONFIG: BuiltinWebConfig = {
  providerOrder: ["deepseek", "tavily", "local"],
  credentials: {},
};

export function filterProvidersByCapability(
  capability: WebCapability
): ProviderMeta[] {
  return WEB_PROVIDER_CATALOG.filter((provider) =>
    provider.capabilities.includes(capability)
  );
}

export function normalizeProviderOrder(value: unknown): ProviderId[] {
  const configuredIds = Array.isArray(value) ? value : [];
  const ordered = new Set<ProviderId>();

  for (const id of configuredIds) {
    if (
      typeof id === "string" &&
      id !== LOCAL_PROVIDER_ID &&
      KNOWN_PROVIDER_IDS.has(id as ProviderId)
    ) {
      ordered.add(id as ProviderId);
    }
  }

  for (const provider of WEB_PROVIDER_CATALOG) {
    if (provider.id !== LOCAL_PROVIDER_ID) ordered.add(provider.id);
  }

  return [...ordered, LOCAL_PROVIDER_ID];
}

export function normalizeBuiltinWebConfig(value: unknown): BuiltinWebConfig {
  const raw = isRecord(value) ? value : {};
  return {
    providerOrder: normalizeProviderOrder(raw.providerOrder),
    credentials: normalizeCredentials(raw.credentials),
  };
}

export function parseBuiltinWebConfig(raw: string | null | undefined): BuiltinWebConfig {
  if (!raw) return createDefaultBuiltinWebConfig();

  try {
    return normalizeBuiltinWebConfig(JSON.parse(raw));
  } catch {
    return createDefaultBuiltinWebConfig();
  }
}

export function createDefaultBuiltinWebConfig(): BuiltinWebConfig {
  return {
    providerOrder: [...DEFAULT_BUILTIN_WEB_CONFIG.providerOrder],
    credentials: {},
  };
}

export function clampSearchResultCount(value: unknown): number {
  return clampWholeNumber(value, SEARCH_LIMIT_DEFAULT, 1, SEARCH_LIMIT_MAX);
}

export function clampFetchBodyChars(value: unknown): number {
  return clampWholeNumber(value, FETCH_BODY_DEFAULT, 1, FETCH_BODY_HARD_LIMIT);
}

export function truncateUnicode(value: string, maxCodePoints: number): string {
  const max = Math.max(0, Math.floor(maxCodePoints));
  if (!Number.isFinite(max)) return "";
  return Array.from(value).slice(0, max).join("");
}

export function capSearchText(value: string): string {
  return truncateUnicode(value, SEARCH_TEXT_HARD_LIMIT);
}

export function capFetchText(value: string): string {
  return truncateUnicode(value, FETCH_TEXT_HARD_LIMIT);
}

export function capFetchLinksText(value: string): string {
  return truncateUnicode(value, FETCH_LINKS_BUDGET);
}

export function capProviderErrorBody(value: string): string {
  return truncateUnicode(value, PROVIDER_ERROR_BODY_LIMIT);
}

export function serializedDetailsLength(value: unknown): number {
  return safelySerialize(value).length;
}

/**
 * Returns a JSON-compatible copy within the requested serialized budget.
 * Every positive limit can represent at least `0`; a zero limit cannot
 * represent a valid JSON value.
 */
export function capSerializedDetails(
  value: JsonValue,
  maxChars: number
): JsonValue {
  const limit = Number.isFinite(maxChars)
    ? Math.max(0, Math.floor(maxChars))
    : 0;
  return capJsonValue(value, limit)?.value ?? minimumJsonValue(limit);
}

function normalizeCredentials(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};

  const credentials: Record<string, string> = {};
  for (const [key, credential] of Object.entries(value)) {
    if (typeof credential !== "string") continue;
    if (KNOWN_CREDENTIAL_KEYS.has(key) && credential.trim() === "") continue;
    credentials[key] = credential;
  }
  return credentials;
}

function clampWholeNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safelySerialize(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return "null";
  }
}

interface CappedJsonValue {
  value: JsonValue;
  serializedLength: number;
}

function capJsonValue(
  value: JsonValue,
  maxChars: number
): CappedJsonValue | null {
  if (typeof value === "string") return capJsonString(value, maxChars);

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    const normalizedValue =
      typeof value === "number" && !Number.isFinite(value) ? null : value;
    const serializedLength = (JSON.stringify(normalizedValue) ?? "null").length;
    return serializedLength <= maxChars
      ? { value: normalizedValue, serializedLength }
      : null;
  }

  if (Array.isArray(value)) return capJsonArray(value, maxChars);
  return capJsonObject(value, maxChars);
}

function capJsonString(
  value: string,
  maxChars: number
): CappedJsonValue | null {
  if (maxChars < 2) return null;

  const codePoints: string[] = [];
  let serializedLength = 2;

  for (const codePoint of value) {
    const codePointLength = (JSON.stringify(codePoint) ?? '""').length - 2;
    if (serializedLength + codePointLength > maxChars) break;
    codePoints.push(codePoint);
    serializedLength += codePointLength;
  }

  return { value: codePoints.join(""), serializedLength };
}

function capJsonArray(
  value: JsonValue[],
  maxChars: number
): CappedJsonValue | null {
  if (maxChars < 2) return null;

  const capped: JsonValue[] = [];
  let serializedLength = 2;

  for (const item of value) {
    const separatorLength = capped.length === 0 ? 0 : 1;
    const itemCapped = capJsonValue(
      item,
      maxChars - serializedLength - separatorLength
    );
    if (!itemCapped) break;

    capped.push(itemCapped.value);
    serializedLength += separatorLength + itemCapped.serializedLength;
  }

  return { value: capped, serializedLength };
}

function capJsonObject(
  value: JsonObject,
  maxChars: number
): CappedJsonValue | null {
  if (maxChars < 2) return null;

  const capped: JsonObject = {};
  let serializedLength = 2;
  let propertyCount = 0;

  for (const [key, item] of Object.entries(value)) {
    const separatorLength = propertyCount === 0 ? 0 : 1;
    const propertyPrefixLength =
      separatorLength + (JSON.stringify(key) ?? '""').length + 1;
    const itemCapped = capJsonValue(
      item,
      maxChars - serializedLength - propertyPrefixLength
    );
    if (!itemCapped) break;

    capped[key] = itemCapped.value;
    serializedLength += propertyPrefixLength + itemCapped.serializedLength;
    propertyCount += 1;
  }

  return { value: capped, serializedLength };
}

function minimumJsonValue(limit: number): JsonValue {
  if (limit >= 2) return [];
  if (limit === 1) return 0;
  return null;
}
