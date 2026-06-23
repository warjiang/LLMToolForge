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
  /** Output modalities the model can produce. */
  outputModalities?: Modality[];
  /** Whether the model uses an image generation endpoint instead of chat. */
  supportsImageGeneration?: boolean;
  /** Whether the model uses a video/content generation endpoint instead of chat. */
  supportsVideoGeneration?: boolean;
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

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  params?: ChatParams;
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
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
  toolCalls?: ToolCall[];
  usage?: ChatUsage;
  raw?: unknown;
}

export interface ImageGenerationRequest {
  model: string;
  prompt: string;
  size?: string;
  responseFormat?: "url" | "b64_json";
  sequentialImageGeneration?: "disabled" | "auto";
  watermark?: boolean;
  signal?: AbortSignal;
}

export interface ImageGenerationImage {
  url?: string;
  b64Json?: string;
  revisedPrompt?: string;
  mime?: string;
}

export interface ImageGenerationResult {
  images: ImageGenerationImage[];
  usage?: ChatUsage;
  raw?: unknown;
}

export interface VideoGenerationReference {
  kind: "image" | "video" | "audio";
  url: string;
  role?: "reference_image" | "reference_video" | "reference_audio";
}

export interface VideoGenerationRequest {
  model: string;
  prompt: string;
  references?: VideoGenerationReference[];
  generateAudio?: boolean;
  ratio?: string;
  duration?: number;
  watermark?: boolean;
  signal?: AbortSignal;
}

export interface VideoGenerationVideo {
  url?: string;
  lastFrameUrl?: string;
  mime?: string;
}

export interface VideoGenerationResult {
  taskId?: string;
  status?: string;
  videos: VideoGenerationVideo[];
  raw?: unknown;
}

export interface VideoGenerationTaskRequest {
  taskId: string;
  signal?: AbortSignal;
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

  /** Non-streaming image generation. */
  imageGeneration?(
    req: ImageGenerationRequest,
    cred: ProviderCredential
  ): Promise<ImageGenerationResult>;

  /** Async video/content generation task creation. */
  videoGeneration?(
    req: VideoGenerationRequest,
    cred: ProviderCredential
  ): Promise<VideoGenerationResult>;

  /** Query an async video/content generation task. */
  getVideoGenerationTask?(
    req: VideoGenerationTaskRequest,
    cred: ProviderCredential
  ): Promise<VideoGenerationResult>;
}
