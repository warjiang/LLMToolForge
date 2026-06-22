/**
 * HTTP transport abstraction.
 *
 * Inside Tauri we use the `@tauri-apps/plugin-http` `fetch`, which is issued
 * from the Rust side and therefore bypasses the WebView CORS restrictions and
 * supports streaming response bodies. In a plain browser (`pnpm dev`) we fall
 * back to the native `fetch`, which will be subject to CORS — live calls to
 * Volcengine will fail there, but the UI still renders for development.
 */

function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    (("__TAURI_INTERNALS__" in window) || "__TAURI__" in window)
  );
}

type FetchFn = typeof fetch;

let cached: FetchFn | null = null;

async function resolveFetch(): Promise<FetchFn> {
  if (cached) return cached;
  if (isTauri()) {
    const mod = await import("@tauri-apps/plugin-http");
    cached = mod.fetch as unknown as FetchFn;
  } else {
    cached = window.fetch.bind(window);
  }
  return cached;
}

/**
 * CORS-safe fetch. Use this for every outbound request to model providers.
 */
export async function httpFetch(
  input: string,
  init?: RequestInit
): Promise<Response> {
  const f = await resolveFetch();
  return f(input, init);
}

export function isLiveRequestSupported(): boolean {
  return isTauri();
}
