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
export function modelConfig(config) {
  return {
    baseURL: config?.baseUrl ?? process.env.UNIFIED_BASE_URL ?? "",
    apiKey: config?.localKey ?? process.env.UNIFIED_API_KEY ?? "",
    model: config?.model ?? process.env.UNIFIED_MODEL ?? "",
  };
}
