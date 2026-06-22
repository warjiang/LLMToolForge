/**
 * Static capability catalog for Volcengine (Ark / Doubao) foundation models.
 *
 * The Ark management & inference APIs do NOT expose per-model capabilities
 * (context window, vision, tool calling). We keep a static catalog keyed by the
 * foundation model name (the prefix before the version date) and merge it into
 * the model list fetched from the API.
 *
 * Values are sourced from public Volcengine docs and are best-effort; they may
 * lag behind the latest model releases. Update as needed.
 */

export interface CatalogEntry {
  /** Match by prefix on the foundation model name (case-insensitive). */
  prefix: string;
  label: string;
  contextWindow?: number;
  supportsFunctionCall?: boolean;
  supportsVision?: boolean;
  tags?: string[];
}

/**
 * Ordered most-specific prefix first so lookups match the narrowest entry.
 */
export const VOLC_MODEL_CATALOG: CatalogEntry[] = [
  // Vision-capable Doubao
  {
    prefix: "doubao-1-5-thinking-vision",
    label: "Doubao 1.5 Thinking Vision",
    contextWindow: 128000,
    supportsFunctionCall: true,
    supportsVision: true,
    tags: ["vision", "thinking", "reasoning"],
  },
  {
    prefix: "doubao-1-5-ui-tars",
    label: "Doubao 1.5 UI-TARS",
    contextWindow: 128000,
    supportsFunctionCall: true,
    supportsVision: true,
    tags: ["vision", "agent"],
  },
  {
    prefix: "doubao-1-5-vision",
    label: "Doubao 1.5 Vision",
    contextWindow: 32768,
    supportsFunctionCall: true,
    supportsVision: true,
    tags: ["vision"],
  },
  {
    prefix: "doubao-vision",
    label: "Doubao Vision",
    contextWindow: 32768,
    supportsFunctionCall: true,
    supportsVision: true,
    tags: ["vision"],
  },
  {
    prefix: "doubao-seed",
    label: "Doubao Seed",
    contextWindow: 256000,
    supportsFunctionCall: true,
    supportsVision: true,
    tags: ["vision", "multimodal"],
  },
  // Doubao 1.5 text
  {
    prefix: "doubao-1-5-pro-256k",
    label: "Doubao 1.5 Pro 256k",
    contextWindow: 256000,
    supportsFunctionCall: true,
    tags: ["long-context"],
  },
  {
    prefix: "doubao-1-5-pro-32k",
    label: "Doubao 1.5 Pro 32k",
    contextWindow: 32768,
    supportsFunctionCall: true,
  },
  {
    prefix: "doubao-1-5-lite",
    label: "Doubao 1.5 Lite",
    contextWindow: 32768,
    supportsFunctionCall: true,
  },
  {
    prefix: "doubao-1-5-thinking",
    label: "Doubao 1.5 Thinking",
    contextWindow: 128000,
    supportsFunctionCall: true,
    tags: ["thinking", "reasoning"],
  },
  // Doubao Pro / Lite (legacy naming)
  {
    prefix: "doubao-pro-256k",
    label: "Doubao Pro 256k",
    contextWindow: 256000,
    supportsFunctionCall: true,
    tags: ["long-context"],
  },
  {
    prefix: "doubao-pro-128k",
    label: "Doubao Pro 128k",
    contextWindow: 128000,
    supportsFunctionCall: true,
    tags: ["long-context"],
  },
  {
    prefix: "doubao-pro-32k",
    label: "Doubao Pro 32k",
    contextWindow: 32768,
    supportsFunctionCall: true,
  },
  {
    prefix: "doubao-pro-4k",
    label: "Doubao Pro 4k",
    contextWindow: 4096,
    supportsFunctionCall: true,
  },
  {
    prefix: "doubao-lite-128k",
    label: "Doubao Lite 128k",
    contextWindow: 128000,
    supportsFunctionCall: true,
    tags: ["long-context"],
  },
  {
    prefix: "doubao-lite-32k",
    label: "Doubao Lite 32k",
    contextWindow: 32768,
    supportsFunctionCall: true,
  },
  {
    prefix: "doubao-lite-4k",
    label: "Doubao Lite 4k",
    contextWindow: 4096,
    supportsFunctionCall: true,
  },
  // Third-party models hosted on Ark
  {
    prefix: "deepseek-r1",
    label: "DeepSeek R1",
    contextWindow: 64000,
    supportsFunctionCall: false,
    tags: ["thinking", "reasoning", "deepseek"],
  },
  {
    prefix: "deepseek-v3",
    label: "DeepSeek V3",
    contextWindow: 64000,
    supportsFunctionCall: true,
    tags: ["deepseek"],
  },
  {
    prefix: "kimi",
    label: "Kimi",
    contextWindow: 128000,
    supportsFunctionCall: true,
    tags: ["long-context", "moonshot"],
  },
  {
    prefix: "moonshot",
    label: "Moonshot",
    contextWindow: 128000,
    supportsFunctionCall: true,
    tags: ["long-context", "moonshot"],
  },
];

/**
 * Look up catalog metadata for a foundation model name (e.g. "doubao-pro-32k").
 * Returns the first entry whose prefix matches the start of the name.
 */
export function lookupCatalog(
  foundationModelName: string | undefined | null
): CatalogEntry | undefined {
  if (!foundationModelName) return undefined;
  // Normalize separators so "doubao-1.5-vision" / "doubao_1_5_vision" all match
  // the dash-based catalog prefixes.
  const name = foundationModelName.toLowerCase().replace(/[._]/g, "-");
  return VOLC_MODEL_CATALOG.find((e) =>
    name.startsWith(e.prefix.toLowerCase().replace(/[._]/g, "-"))
  );
}
