import type { ModelInfo } from "@/lib/providers/types";

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
  /** Manually configured model ids usable in the Playground. */
  models?: string[];
}

export type SkillStatus = "enabled" | "disabled";

export type SkillAgentKey =
  | "claude_code"
  | "codex"
  | "cursor"
  | "opencode"
  | "gemini_cli"
  | "github_copilot"
  | "kiro"
  | "qoder"
  | "droid"
  | "openclaw"
  | "hermes";

export type SkillSyncMode = "copy" | "symlink";

/** Origin of a skill's content. `manual` skills are authored in-app. */
export type SkillSourceType = "manual" | "github";

/** A single file belonging to a multi-file skill, stored verbatim. */
export interface SkillFile {
  /** POSIX-relative path within the skill directory, e.g. "references/x.md". */
  path: string;
  /** File content: UTF-8 text, or base64 when `encoding` is "base64". */
  content: string;
  encoding: "utf8" | "base64";
}

/**
 * External prerequisites a skill needs at runtime, declared in its SKILL.md
 * `metadata.requires` block. We surface these to the user (and detect missing
 * ones) but never auto-install them.
 */
export interface SkillRequirements {
  /** Executables that must be on PATH, e.g. ["lark-cli"]. */
  bins?: string[];
}

export interface Skill extends BaseEntity {
  name: string;
  description: string;
  enabled: boolean;
  tags: string[];
  content?: string;
  agentKeys?: SkillAgentKey[];
  syncMode?: SkillSyncMode;
  /** How the skill was obtained. Absent means legacy/manual. */
  sourceType?: SkillSourceType;
  /** For github skills: "owner/repo". */
  source?: string;
  /** For github skills: path to SKILL.md within the repo. */
  skillPath?: string;
  /** For github skills: branch / tag / commit the content was pulled from. */
  sourceRef?: string;
  /** sha256 of the installed SKILL.md content, for update detection. */
  installedHash?: string;
  /** Optional popularity hint carried over from a market listing. */
  installs?: number;
  /**
   * Full file set for multi-file skills (SKILL.md plus references/scripts).
   * When present, these are written verbatim on sync; otherwise SKILL.md is
   * generated from name/description/content.
   */
  files?: SkillFile[];
  /** External tools the skill expects to exist (from `metadata.requires`). */
  requires?: SkillRequirements;
}

/** A market that can be searched for installable skills. */
export type SkillMarketProviderId = "github" | "skills_sh";

/** A skill entry as listed by a market search, before its body is fetched. */
export interface MarketSkillSummary {
  /** Stable identity within the provider, e.g. "owner/repo/skillId". */
  id: string;
  /** Display name (skill folder / frontmatter name). */
  name: string;
  /** "owner/repo" the content lives in. */
  source: string;
  /** Path to SKILL.md within the repo, when already known. */
  skillPath?: string;
  /** Branch / tag the listing points at. */
  ref?: string;
  description?: string;
  installs?: number;
  provider: SkillMarketProviderId;
}

/** A fully-resolved skill ready to be installed. */
export interface MarketSkillDetail {
  name: string;
  description: string;
  content: string;
  source: string;
  skillPath: string;
  ref: string;
  hash: string;
  installs?: number;
  provider: SkillMarketProviderId;
  /** All files in the skill directory (incl. SKILL.md) for multi-file skills. */
  files?: SkillFile[];
  /** External tools the skill expects to exist (from `metadata.requires`). */
  requires?: SkillRequirements;
  /** Count of sibling files skipped during fetch (too large / too many). */
  skippedFiles?: number;
}

export interface SkillProjectConfig extends BaseEntity {
  name: string;
  projectPath: string;
  agentKeys: SkillAgentKey[];
  skillIds: string[];
  syncMode: SkillSyncMode;
  enabled: boolean;
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
  /** Last fetched models (endpoints), persisted for reuse. */
  models?: ModelInfo[];
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
  /** Last fetched models, persisted for reuse. */
  models?: ModelInfo[];
}

/** Kind of provider, used to drive the unified Providers page. */
export type ProviderKind = "volcengine" | "manual" | GatewayProvider;

export interface ProviderMeta {
  /** Provider id, also the adapter key. */
  id: ProviderKind;
  label: string;
  description: string;
  /** Whether the provider uses the OpenAI-compatible gateway model. */
  kind: "volc" | "gateway" | "manual";
}

export const PROVIDER_METAS: ProviderMeta[] = [
  {
    id: "volcengine",
    label: "Volcengine",
    description: "provider_desc_volcengine",
    kind: "volc",
  },
  {
    id: "new-api",
    label: "New API",
    description: "provider_desc_new_api",
    kind: "gateway",
  },
  {
    id: "litellm",
    label: "LiteLLM",
    description: "provider_desc_litellm",
    kind: "gateway",
  },
  {
    id: "dmxapi",
    label: "DMX",
    description: "provider_desc_dmxapi",
    kind: "gateway",
  },
  {
    id: "manual",
    label: "provider_label_manual",
    description: "provider_desc_manual",
    kind: "manual",
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
  { value: "stdio", label: "mcp_transport_stdio" },
  { value: "sse", label: "mcp_transport_sse" },
  { value: "http", label: "mcp_transport_http" },
];

/** Built-in internal tools an agent can be granted. */
export type AgentInternalToolId =
  | "checkpoint"
  | "ask_human"
  | "bash"
  | "read"
  | "write"
  | "edit"
  | "ls"
  | "grep"
  | "duckdb_query"
  | "data_chart_html"
  | "data_report_html"
  | "html_artifact_create"
  | "html_artifact_block"
  | "web_fetch";

export type AgentSandboxMode =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

/**
 * A user-defined (or built-in) agent: a reusable bundle of system prompt,
 * model routing, enabled tools/skills/MCP, and sandbox configuration. The
 * execution root is supplied by the chat/session runtime, so agents can be
 * reused across workspaces.
 */
export interface AgentDefinition extends BaseEntity {
  name: string;
  description: string;
  systemPrompt: string;
  /** Exposed Unified-gateway model id (`{connName}/{model}`). */
  modelId: string;
  enabledInternalTools: AgentInternalToolId[];
  enabledSkillIds: string[];
  enabledMcpServerIds: string[];
  sandboxMode: AgentSandboxMode;
  /**
   * @deprecated Execution root now comes from ChatSessionSettings.workspacePath.
   * Kept so older saved agent definitions still deserialize cleanly.
   */
  workspacePath: string;
  temperature: number;
  maxTokens: number;
}

export const AGENT_INTERNAL_TOOL_IDS: AgentInternalToolId[] = [
  "checkpoint",
  "ask_human",
  "bash",
  "read",
  "write",
  "edit",
  "ls",
  "grep",
  "duckdb_query",
  "data_chart_html",
  "data_report_html",
  "html_artifact_create",
  "html_artifact_block",
  "web_fetch",
];
