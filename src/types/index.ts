export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKey extends BaseEntity {
  name: string;
  provider: string;
  key: string;
  baseUrl?: string;
  note?: string;
}

export type SkillStatus = "enabled" | "disabled";

export interface Skill extends BaseEntity {
  name: string;
  description: string;
  enabled: boolean;
  tags: string[];
  content?: string;
}

export type McpTransport = "stdio" | "sse" | "http";

export interface McpServer extends BaseEntity {
  name: string;
  description?: string;
  transport: McpTransport;
  command?: string;
  args: string[];
  url?: string;
  env: Record<string, string>;
  enabled: boolean;
}

export interface ArkApiKeyRef {
  /** Numeric id from the Ark management API. */
  arkId?: number;
  name: string;
  /** Raw secret value, fetched on demand via GetRawApiKey. */
  key?: string;
}

export interface VolcCredential extends BaseEntity {
  name: string;
  accessKey: string;
  secretKey: string;
  region: string;
  /** Ark project the keys/endpoints live under (default: "default"). */
  project: string;
  /** Saved Ark API keys usable for inference. */
  apiKeys: ArkApiKeyRef[];
}

export const VOLC_DEFAULT_PROJECT = "default";

export const VOLC_REGIONS = ["cn-beijing", "ap-southeast-1"] as const;

/** OpenAI-compatible gateway providers (single Base URL + API Key). */
export type GatewayProvider = "new-api" | "litellm" | "dmxapi";

/**
 * A connection to an OpenAI-compatible gateway (new-api / litellm).
 * Models are fetched on demand via `/v1/models`.
 */
export interface GatewayConnection extends BaseEntity {
  name: string;
  provider: GatewayProvider;
  baseUrl: string;
  apiKey: string;
}

/** Kind of provider, used to drive the unified Providers page. */
export type ProviderKind = "volcengine" | GatewayProvider;

export interface ProviderMeta {
  /** Provider id, also the adapter key. */
  id: ProviderKind;
  label: string;
  description: string;
  /** Whether the provider uses the OpenAI-compatible gateway model. */
  kind: "volc" | "gateway";
}

export const PROVIDER_METAS: ProviderMeta[] = [
  {
    id: "volcengine",
    label: "Volcengine 火山引擎",
    description: "AK/SK 拉取已开通的模型与 Ark API Key",
    kind: "volc",
  },
  {
    id: "new-api",
    label: "New API",
    description: "OpenAI 兼容网关，Base URL + API Key",
    kind: "gateway",
  },
  {
    id: "litellm",
    label: "LiteLLM",
    description: "OpenAI 兼容代理，Base URL + API Key",
    kind: "gateway",
  },
  {
    id: "dmxapi",
    label: "DMXAPI",
    description: "OpenAI 兼容聚合平台，Base URL + API Key",
    kind: "gateway",
  },
];

export const GATEWAY_PROVIDERS = PROVIDER_METAS.filter(
  (p) => p.kind === "gateway"
) as (ProviderMeta & { id: GatewayProvider })[];

export const PROVIDERS = [
  "OpenAI",
  "Anthropic",
  "Google",
  "Azure OpenAI",
  "Mistral",
  "Groq",
  "DeepSeek",
  "Ollama",
  "Custom",
] as const;

export const MCP_TRANSPORTS: { value: McpTransport; label: string }[] = [
  { value: "stdio", label: "Stdio (本地进程)" },
  { value: "sse", label: "SSE (Server-Sent Events)" },
  { value: "http", label: "HTTP (Streamable)" },
];
