/**
 * Route the Pi/OpenAI SDK's HTTP traffic to the local Unified gateway through
 * Tauri's `plugin-http` fetch.
 *
 * pi-ai builds `new OpenAI({ baseURL, dangerouslyAllowBrowser: true })`, which
 * uses the WebView's global `fetch`. Inside a Tauri WebView a `fetch` to
 * `http://127.0.0.1:<port>` is cross-origin and gets blocked by WKWebView's
 * CORS enforcement (the gateway sends no `Access-Control-Allow-Origin`), so the
 * SDK only ever sees a generic "Connection error.".
 *
 * pi-ai exposes no hook to inject a custom `fetch`, so we install a one-time
 * global `fetch` shim that delegates *only loopback requests* (the gateway) to
 * the Rust-side `plugin-http` fetch, which bypasses CORS and supports streaming.
 * Every other request keeps using the original WebView `fetch`, so app
 * behaviour is otherwise unchanged.
 */

function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

const LOOPBACK_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isLoopback(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Only intercept real HTTP(S) traffic to the gateway. Tauri's own IPC (and
    // therefore plugin-http's internal invokes) travels over custom schemes such
    // as `ipc://localhost` / `tauri://localhost`, whose hostname is also
    // "localhost". Routing those back through plugin-http — which itself relies
    // on that IPC — causes unbounded fetch recursion that freezes the WebView.
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    return LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

let installed = false;

/**
 * Idempotently install the loopback-routing `fetch` shim. No-op outside Tauri.
 * Safe to call before every agent run.
 */
export async function ensureGatewayFetch(): Promise<void> {
  if (installed || !isTauri()) return;
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
  installed = true;

  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (isLoopback(url)) {
      console.debug("[gatewayFetch] routing via plugin-http", url);
      return (tauriFetch as unknown as typeof fetch)(input, init).then(
        (res) => {
          console.debug("[gatewayFetch] response", url, res.status, {
            contentType: res.headers.get("content-type"),
            hasBody: Boolean(res.body),
          });
          return res;
        },
        (err) => {
          console.error("[gatewayFetch] plugin-http error", url, err);
          throw err;
        },
      );
    }
    return original(input, init);
  }) as typeof fetch;
}
