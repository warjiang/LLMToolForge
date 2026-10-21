import {
  WEB_PROVIDER_CATALOG,
  type ProviderId,
} from "@/lib/agent/tools/webProviderCatalog";

const WEB_TOOL_NAMES = new Set(["web_search", "web_fetch"]);
const PROVIDER_IDS = new Set<ProviderId>(
  WEB_PROVIDER_CATALOG.map((provider) => provider.id)
);

export function webToolProviderLabel(
  toolName: string,
  resultJson: unknown
): string | null {
  if (!WEB_TOOL_NAMES.has(toolName) || !isRecord(resultJson)) return null;
  const provider = resultJson.provider;
  if (typeof provider !== "string" || !PROVIDER_IDS.has(provider as ProviderId)) {
    return null;
  }
  return (
    WEB_PROVIDER_CATALOG.find((item) => item.id === provider)?.displayName ??
    null
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
