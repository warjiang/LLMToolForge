/**
 * Model config helper. The host injects the Unified gateway coordinates via env
 * (and also in the `init` message's `config`). This exposes them in the shape
 * OpenAI-compatible SDKs expect.
 */

/**
 * Read the Unified gateway model config, preferring the per-run `init` config
 * and falling back to the injected environment variables.
 * @param {{baseUrl?:string, localKey?:string, model?:string}|null} config
 */
/**
 * Read the Unified gateway model config, preferring the per-run `init` config
 * and falling back to the injected environment variables.
 *
 * `userAgent` (when provided by the host) lets the app's call monitor attribute
 * Unified requests to this specific agent. Spread `headers` into your provider
 * client (e.g. `createOpenAI({ headers })`) so the User-Agent is applied.
 *
 * @param {{baseUrl?:string, localKey?:string, model?:string,
 *   temperature?:number, maxTokens?:number, userAgent?:string}|null} config
 */
export function modelConfig(config) {
  const userAgent = config?.userAgent ?? process.env.UNIFIED_USER_AGENT ?? "";
  const headers = userAgent ? { "User-Agent": userAgent } : {};
  return {
    baseURL: config?.baseUrl ?? process.env.UNIFIED_BASE_URL ?? "",
    apiKey: config?.localKey ?? process.env.UNIFIED_API_KEY ?? "",
    model: config?.model ?? process.env.UNIFIED_MODEL ?? "",
    temperature: config?.temperature ?? numFromEnv(process.env.UNIFIED_TEMPERATURE),
    maxTokens: config?.maxTokens ?? numFromEnv(process.env.UNIFIED_MAX_TOKENS),
    userAgent,
    headers,
  };
}

function numFromEnv(v) {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
