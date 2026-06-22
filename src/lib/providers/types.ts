/**
 * Provider-agnostic types for the model adapter layer.
 *
 * The goal is a single normalized shape the Playground talks to, while each
 * concrete provider (Volcengine today; OpenAI / Anthropic / Gemini later)
 * translates to/from its own wire format.
 */

export type Modality = "text" | "image" | "audio" | "video";

/** Normalized description of a model and its capabilities. */
export interface ModelInfo {
  /** Stable identifier used when calling the model (model name or endpoint id). */
  id: string;
  /** Human friendly display name. */
  name: string;
  /** Provider key, e.g. "volcengine". */
  provider: string;
  /** Max context window in tokens, if known. */
  contextWindow?: number;
  /** Max output tokens, if known. */
  maxOutputTokens?: number;
  /** Whether the model supports function/tool calling. */
  supportsFunctionCall?: boolean;
  /** Whether the model accepts image input (vision). */
  supportsVision?: boolean;
  /** Input modalities the model accepts. */
  inputModalities?: Modality[];
  /** Free-form tags for display/filtering (e.g. "thinking", "deepseek"). */
  tags?: string[];
  /** Raw payload from the provider, for debugging. */
  raw?: unknown;
}

/** A piece of multimodal content within a message. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; /** data URL or remote URL */ url: string };

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  /** Either a plain string or structured multimodal parts. */
  content: string | ContentPart[];
}

/** Wire formats a provider may expose. */
export type WireFormat =
  | "openai-chat"
  | "openai-responses"
  | "anthropic"
  | "gemini";

export interface ChatParams {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  params?: ChatParams;
  /** Selected wire format; defaults to the adapter's primary format. */
  wireFormat?: WireFormat;
  stream?: boolean;
  signal?: AbortSignal;
}

export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ChatResult {
  content: string;
  usage?: ChatUsage;
  raw?: unknown;
}

/** Incremental chunk emitted during streaming. */
export interface ChatStreamChunk {
  delta: string;
  done: boolean;
  usage?: ChatUsage;
}

/**
 * Credential bundle handed to an adapter. Shape is provider specific; the
 * adapter knows how to read what it needs.
 */
export interface ProviderCredential {
  /** Bearer-style API key (e.g. Ark API Key). */
  apiKey?: string;
  /** AK/SK pair for signature-based management APIs. */
  accessKey?: string;
  secretKey?: string;
  /** Optional base URL / region overrides. */
  baseUrl?: string;
  region?: string;
}

/**
 * A provider adapter. Implementations live under
 * `src/lib/providers/<provider>/`.
 */
export interface ProviderAdapter {
  readonly provider: string;
  /** Wire formats this adapter can speak, primary first. */
  readonly wireFormats: WireFormat[];

  /** List models available to the given credential. */
  listModels(cred: ProviderCredential): Promise<ModelInfo[]>;

  /** Non-streaming chat. */
  chat(req: ChatRequest, cred: ProviderCredential): Promise<ChatResult>;

  /** Streaming chat; yields incremental chunks. */
  chatStream?(
    req: ChatRequest,
    cred: ProviderCredential
  ): AsyncGenerator<ChatStreamChunk, void, unknown>;
}
