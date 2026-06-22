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
  /** Saved Ark API keys usable for inference. */
  apiKeys: ArkApiKeyRef[];
}

export const VOLC_REGIONS = ["cn-beijing", "ap-southeast-1"] as const;

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
