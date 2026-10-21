import { describe, expect, it, vi } from "vitest";
import {
  FETCH_BODY_HARD_LIMIT,
  FETCH_DETAILS_HARD_LIMIT,
} from "./webProviderCatalog";
import {
  ProviderHttpError,
  ProviderPayloadError,
  createProviderAdapters,
  normalizeFetchResponse,
  normalizeSearchResponse,
  resolveChain,
  runChain,
  type WebSearchResponse,
} from "./searchProviders";

const deepseekConfig = {
  providerOrder: ["deepseek", "tavily", "local"] as const,
  credentials: { DEEPSEEK_API_KEY: "deepseek-secret" },
};

const allProvidersConfig = {
  providerOrder: ["deepseek", "tavily", "local"] as const,
  credentials: {
    DEEPSEEK_API_KEY: "deepseek-secret",
    TAVILY_API_KEY: "tavily-secret",
  },
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function abortError(): DOMException {
  return new DOMException("Aborted by caller", "AbortError");
}

function credentialVariants(secret: string) {
  const percentEncoded = encodeURIComponent(secret);
  const formEncoded = percentEncoded.replace(/%20/g, "+");
  const lowercasePercentEncoded = percentEncoded.replace(
    /%[0-9A-F]{2}/g,
    (escape) => escape.toLowerCase()
  );
  const lowercaseFormEncoded = formEncoded.replace(
    /%[0-9A-F]{2}/g,
    (escape) => escape.toLowerCase()
  );

  return {
    raw: secret,
    jsonEscaped: JSON.stringify(secret).slice(1, -1),
    percentEncoded,
    formEncoded,
    lowercasePercentEncoded,
    lowercaseFormEncoded,
  };
}

function expectCredentialVariantsRedacted(
  value: string,
  variants: ReturnType<typeof credentialVariants>
): void {
  expect(value).toContain("[redacted]");
  for (const variant of Object.values(variants)) {
    expect(value).not.toContain(variant);
  }
}

describe("provider chain resolution", () => {
  it("gates keyed providers and preserves canonical local fallback order", () => {
    expect(resolveChain("search", {
      providerOrder: ["local", "tavily", "unknown", "deepseek"] as never,
      credentials: { DEEPSEEK_API_KEY: "  deepseek-secret  " },
    })).toEqual(["deepseek", "local"]);

    expect(resolveChain("fetch", {
      providerOrder: ["tavily", "local"] as const,
      credentials: {},
    })).toEqual(["local"]);
  });

  it("uses catalog capabilities and limits rendered fetches to the local provider", () => {
    expect(resolveChain("fetch", allProvidersConfig)).toEqual([
      "deepseek",
      "tavily",
      "local",
    ]);
    expect(resolveChain("fetch", allProvidersConfig, { render: true }))
      .toEqual(["local"]);
  });
});

describe("provider runner", () => {
  it("returns the first non-soft-miss provider response", async () => {
    const attempted: string[] = [];
    const result = await runChain<string>({
      chain: ["deepseek", "tavily", "local"],
      operation: "search",
      attempt: async (provider) => {
        attempted.push(provider);
        if (provider === "deepseek") return "";
        return "tavily-result";
      },
      isSoftMiss: (value) => value === "",
    });

    expect(result).toBe("tavily-result");
    expect(attempted).toEqual(["deepseek", "tavily"]);
  });

  it("falls through ordinary errors and returns the last soft miss when none succeed", async () => {
    const firstError = new Error("first failed");
    const softMiss: WebSearchResponse = { query: "q", results: [] };
    const result = await runChain<WebSearchResponse>({
      chain: ["deepseek", "tavily", "local"],
      operation: "search",
      attempt: async (provider) => {
        if (provider === "deepseek") throw firstError;
        return softMiss;
      },
      isSoftMiss: (value) => value.results.length === 0,
    });

    expect(result).toBe(softMiss);
  });

  it("throws the final provider error when every provider errors", async () => {
    const lastError = new ProviderPayloadError("local", "missing content");
    await expect(runChain<string>({
      chain: ["deepseek", "local"],
      operation: "search",
      attempt: async (provider) => {
        if (provider === "deepseek") throw new Error("first");
        throw lastError;
      },
      isSoftMiss: () => false,
    })).rejects.toBe(lastError);
  });

  it("treats caller cancellation as terminal and does not start another provider", async () => {
    const controller = new AbortController();
    const attempted: string[] = [];
    const pending = runChain<string>({
      chain: ["deepseek", "local"],
      operation: "search",
      signal: controller.signal,
      attempt: async (provider) => {
        attempted.push(provider);
        controller.abort();
        return new Promise<string>(() => undefined);
      },
      isSoftMiss: () => false,
    });

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(attempted).toEqual(["deepseek"]);
  });

  it("falls through a provider deadline and provides the operation deadline to each attempt", async () => {
    vi.useFakeTimers();
    try {
      const attempted: Array<{ provider: string; timeoutMs: number }> = [];
      const pending = runChain<string>({
        chain: ["deepseek", "local"],
        operation: "fetch",
        timeoutMs: 0,
        attempt: async (provider, context) => {
          attempted.push({ provider, timeoutMs: context.timeoutMs });
          if (provider === "deepseek") {
            await new Promise<void>((_resolve, reject) => {
              context.signal.addEventListener(
                "abort",
                () => reject(abortError()),
                { once: true }
              );
            });
          }
          return "local-result";
        },
        isSoftMiss: () => false,
      });

      await vi.advanceTimersByTimeAsync(1_000);
      await expect(pending).resolves.toBe("local-result");
      expect(attempted).toEqual([
        { provider: "deepseek", timeoutMs: 1_000 },
        { provider: "local", timeoutMs: 1_000 },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the fixed 15 second search deadline", async () => {
    const seen: number[] = [];
    const result = await runChain<string>({
      chain: ["local"],
      operation: "search",
      attempt: async (_provider, context) => {
        seen.push(context.timeoutMs);
        return "ok";
      },
      isSoftMiss: () => false,
    });

    expect(result).toBe("ok");
    expect(seen).toEqual([15_000]);
  });
});

describe("provider adapters", () => {
  it("forwards local search and fetch requests through the injectable invoke transport", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({
        query: "local query",
        results: [{ title: "Local", url: "https://local.test", snippet: "hit" }],
      })
      .mockResolvedValueOnce({
        url: "https://local.test",
        finalUrl: "https://local.test/final",
        status: 200,
        title: "Local page",
        text: "local body",
        links: [],
        truncated: false,
        mode: "http",
      });
    const adapters = createProviderAdapters({ invoke });

    await expect(adapters.local.search!({
      query: "local query",
      limit: 9,
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ query: "local query" });
    await expect(adapters.local.fetch!({
      url: "https://local.test",
      render: true,
      maxChars: 321,
      timeoutMs: 4_321,
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ finalUrl: "https://local.test/final" });

    expect(invoke).toHaveBeenNthCalledWith(1, "web_search", {
      req: { query: "local query", limit: 9 },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "web_fetch", {
      req: {
        url: "https://local.test",
        render: true,
        maxChars: 321,
        timeoutMs: 4_321,
      },
    });
  });

  it("normalizes DeepSeek search and fetch fixtures without requesting page bodies", async () => {
    const transport = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        results: [{
          title: "DeepSeek result",
          url: "https://deepseek.test/search",
          snippet: "snippet",
          summary: "preferred summary",
          content: "must not be returned",
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        title: "DeepSeek page",
        content: "# Markdown body",
      }));
    const adapters = createProviderAdapters({ transport });
    const signal = new AbortController().signal;

    await expect(adapters.deepseek.search!({
      query: "deep search",
      limit: 3,
      credentials: deepseekConfig.credentials,
      signal,
    })).resolves.toEqual({
      query: "deep search",
      results: [{
        title: "DeepSeek result",
        url: "https://deepseek.test/search",
        snippet: "preferred summary",
      }],
    });
    await expect(adapters.deepseek.fetch!({
      url: "https://deepseek.test/page",
      credentials: deepseekConfig.credentials,
      signal,
    })).resolves.toMatchObject({
      title: "DeepSeek page",
      text: "# Markdown body",
      mode: "deepseek",
      links: [],
    });

    expect(transport).toHaveBeenNthCalledWith(
      1,
      "https://api.deepseek.com/v1/tools/search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          query: "deep search",
          count: 3,
          need_content: false,
        }),
        headers: expect.objectContaining({
          Authorization: "Bearer deepseek-secret",
        }),
      })
    );
    expect(transport).toHaveBeenNthCalledWith(
      2,
      "https://api.deepseek.com/v1/tools/fetch",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ url: "https://deepseek.test/page" }) })
    );
  });

  it("treats valid empty DeepSeek results and content as soft misses", async () => {
    const transport = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
      .mockResolvedValueOnce(jsonResponse({ title: "Empty", content: "" }));
    const adapters = createProviderAdapters({ transport });
    const signal = new AbortController().signal;

    await expect(adapters.deepseek.search!({
      query: "none",
      limit: 1,
      credentials: deepseekConfig.credentials,
      signal,
    })).resolves.toEqual({ query: "none", results: [] });
    await expect(adapters.deepseek.fetch!({
      url: "https://deepseek.test/empty",
      credentials: deepseekConfig.credentials,
      signal,
    })).resolves.toMatchObject({ title: "Empty", text: "" });
  });

  it("never returns configured credentials when an external provider echoes them", async () => {
    const secret = "deepseek-secret";
    const transport = vi.fn().mockResolvedValue(jsonResponse({
      results: [{
        title: `Title ${secret}`,
        url: `https://deepseek.test/${secret}`,
        summary: `Summary ${secret}`,
      }],
    }));
    const adapters = createProviderAdapters({ transport });

    const result = await adapters.deepseek.search!({
      query: "q",
      limit: 1,
      credentials: { DEEPSEEK_API_KEY: secret },
      signal: new AbortController().signal,
    });

    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("redacts URL-encoded credentials from provider results and error details", async () => {
    const secret = "secret+/= value";
    const variants = credentialVariants(secret);
    const credentials = { DEEPSEEK_API_KEY: secret };
    const resultTransport = vi.fn().mockResolvedValue(jsonResponse({
      results: [{
        title: `Raw ${variants.raw} / ${variants.percentEncoded}`,
        url: `https://deepseek.test/${variants.lowercasePercentEncoded}`,
        summary: `Form ${variants.formEncoded} / ${variants.lowercaseFormEncoded}`,
      }],
    }));
    const result = await createProviderAdapters({ transport: resultTransport })
      .deepseek.search!({
        query: "q",
        limit: 1,
        credentials,
        signal: new AbortController().signal,
      });

    const errorTransport = vi.fn().mockResolvedValue(jsonResponse({
      error: {
        code: `invalid_${variants.raw}_${variants.percentEncoded}_${variants.lowercasePercentEncoded}`,
        message: `Credential rejected: ${variants.raw} / ${variants.formEncoded} / ${variants.lowercaseFormEncoded}`,
      },
    }, 401));
    let thrown: unknown;
    try {
      await createProviderAdapters({ transport: errorTransport }).deepseek.search!({
        query: "q",
        limit: 1,
        credentials,
        signal: new AbortController().signal,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ProviderHttpError);
    const providerError = thrown as ProviderHttpError;
    for (const value of [
      JSON.stringify(result),
      providerError.diagnostic,
      providerError.message,
      String(providerError),
    ]) {
      expectCredentialVariantsRedacted(value, variants);
    }
  });

  it("redacts configured credentials from local search and fetch results and invocation errors", async () => {
    const secret = "local-secret+/= value";
    const variants = credentialVariants(secret);
    const credentials = { DEEPSEEK_API_KEY: secret };
    const invoke = vi.fn()
      .mockResolvedValueOnce({
        query: `search ${variants.raw} ${variants.lowercasePercentEncoded}`,
        results: [{
          title: `Title ${variants.percentEncoded}`,
          url: `https://local.test/${variants.formEncoded}`,
          snippet: `Snippet ${variants.lowercaseFormEncoded}`,
        }],
      })
      .mockResolvedValueOnce({
        url: `https://local.test/${variants.raw}/${variants.percentEncoded}`,
        finalUrl: `https://local.test/final/${variants.lowercasePercentEncoded}`,
        status: 200,
        title: `Title ${variants.formEncoded}`,
        text: `Body ${variants.raw} ${variants.lowercaseFormEncoded}`,
        links: [{
          text: `Link ${variants.percentEncoded}`,
          href: `https://local.test/link/${variants.lowercasePercentEncoded}`,
        }],
        truncated: false,
        mode: `local-${variants.lowercaseFormEncoded}`,
      })
      .mockRejectedValueOnce(
        new Error(
          `Local invocation failed: ${variants.raw} / ${variants.percentEncoded} / ${variants.lowercasePercentEncoded} / ${variants.formEncoded} / ${variants.lowercaseFormEncoded}`
        )
      );
    const adapters = createProviderAdapters({ invoke });
    const signal = new AbortController().signal;

    const search = await adapters.local.search!({
      query: "search",
      limit: 1,
      credentials,
      signal,
    });
    const fetch = await adapters.local.fetch!({
      url: "https://local.test",
      credentials,
      signal,
    });
    let thrown: unknown;
    try {
      await adapters.local.search!({
        query: "search",
        limit: 1,
        credentials,
        signal,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ProviderPayloadError);
    for (const value of [JSON.stringify(search), JSON.stringify(fetch), String(thrown)]) {
      expectCredentialVariantsRedacted(value, variants);
    }
  });

  it("redacts every repeated raw and encoded credential variant from provider results", async () => {
    const variants = credentialVariants('repeat "secret" +/= value');
    const credentials = { DEEPSEEK_API_KEY: variants.raw };
    const invoke = vi.fn().mockResolvedValue({
      url: `https://local.test/${variants.raw}/${variants.raw}`,
      finalUrl: `https://local.test/${variants.jsonEscaped}/${variants.jsonEscaped}`,
      status: 200,
      title: `${variants.lowercasePercentEncoded} ${variants.lowercasePercentEncoded}`,
      text: `${variants.lowercaseFormEncoded} ${variants.lowercaseFormEncoded}`,
      links: [{
        text: `${variants.percentEncoded} ${variants.percentEncoded}`,
        href: `https://local.test/${variants.formEncoded}/${variants.formEncoded}`,
      }],
      truncated: false,
      mode: `local-${variants.lowercaseFormEncoded}-${variants.lowercaseFormEncoded}`,
    });

    const result = await createProviderAdapters({ invoke }).local.fetch!({
      url: "https://local.test",
      credentials,
      signal: new AbortController().signal,
    });

    expectCredentialVariantsRedacted(JSON.stringify(result), variants);
  });

  it("uses Tavily search/extract request shapes and normalizes their fixtures", async () => {
    const transport = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        results: [{
          title: "Tavily result",
          url: "https://tavily.test/search",
          content: "Tavily snippet",
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        results: [{
          url: "https://tavily.test/page",
          raw_content: "# Tavily markdown",
        }],
        failed_results: [],
      }));
    const adapters = createProviderAdapters({ transport });
    const signal = new AbortController().signal;

    await expect(adapters.tavily.search!({
      query: "tavily query",
      limit: 4,
      credentials: allProvidersConfig.credentials,
      signal,
    })).resolves.toMatchObject({
      results: [{ title: "Tavily result", snippet: "Tavily snippet" }],
    });
    await expect(adapters.tavily.fetch!({
      url: "https://tavily.test/page",
      timeoutMs: 2_500,
      credentials: allProvidersConfig.credentials,
      signal,
    })).resolves.toMatchObject({ text: "# Tavily markdown", mode: "tavily" });

    expect(transport).toHaveBeenNthCalledWith(
      1,
      "https://api.tavily.com/search",
      expect.objectContaining({
        body: JSON.stringify({
          query: "tavily query",
          search_depth: "basic",
          max_results: 4,
          chunks_per_source: 1,
          include_raw_content: false,
        }),
      })
    );
    expect(transport).toHaveBeenNthCalledWith(
      2,
      "https://api.tavily.com/extract",
      expect.objectContaining({
        body: JSON.stringify({
          urls: ["https://tavily.test/page"],
          format: "markdown",
          timeout: 3,
        }),
      })
    );
  });

  it("treats valid empty Tavily raw content as a soft miss and requested failures as errors", async () => {
    const transport = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        results: [{ url: "https://tavily.test/page", raw_content: "" }],
        failed_results: [],
      }))
      .mockResolvedValueOnce(jsonResponse({
        results: [],
        failed_results: [{
          url: "https://tavily.test/page",
          error: "upstream unavailable",
        }],
      }));
    const adapters = createProviderAdapters({ transport });
    const request = {
      url: "https://tavily.test/page",
      timeoutMs: 20_000,
      credentials: allProvidersConfig.credentials,
      signal: new AbortController().signal,
    };

    await expect(adapters.tavily.fetch!(request)).resolves
      .toMatchObject({ text: "" });
    await expect(adapters.tavily.fetch!(request)).rejects
      .toBeInstanceOf(ProviderPayloadError);
  });

  it.each([401, 429, 503])(
    "turns HTTP %i into a credential-free bounded provider error",
    async (status) => {
      const secret = "deepseek-secret";
      const transport = vi.fn().mockResolvedValue(jsonResponse(
        { error: { code: "bad_key", message: `${secret}:${"x".repeat(5_000)}` } },
        status
      ));
      const adapters = createProviderAdapters({ transport });

      let thrown: unknown;
      try {
        await adapters.deepseek.search!({
          query: "q",
          limit: 1,
          credentials: { DEEPSEEK_API_KEY: secret },
          signal: new AbortController().signal,
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ProviderHttpError);
      expect(thrown).toMatchObject({ provider: "deepseek", status });
      expect(String(thrown)).not.toContain(secret);
      expect(String(thrown).length).toBeLessThanOrEqual(4_300);
    }
  );

  it("redacts credentials containing JSON-escaped characters from every HTTP error surface", async () => {
    const secret = 'deep"seek-secret';
    const transport = vi.fn().mockResolvedValue(jsonResponse(
      {
        error: {
          code: `invalid_${secret}`,
          message: `Credential rejected: ${secret}`,
        },
      },
      401
    ));
    const adapters = createProviderAdapters({ transport });
    let thrown: unknown;

    try {
      await adapters.deepseek.search!({
        query: "q",
        limit: 1,
        credentials: { DEEPSEEK_API_KEY: secret },
        signal: new AbortController().signal,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ProviderHttpError);
    const providerError = thrown as ProviderHttpError;
    const visibleValues = [
      providerError.name,
      providerError.message,
      providerError.provider,
      String(providerError.status),
      providerError.diagnostic,
      String(providerError),
      providerError.stack ?? "",
      JSON.stringify(providerError),
    ];

    for (const value of visibleValues) {
      expect(value).not.toContain(secret);
    }
  });

  it("rejects malformed JSON and malformed payloads without exposing credentials", async () => {
    const secret = "tavily-secret";
    const transport = vi.fn()
      .mockResolvedValueOnce(new Response("{not-json", { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ results: "wrong shape" }));
    const adapters = createProviderAdapters({ transport });
    const request = {
      query: "q",
      limit: 1,
      credentials: { TAVILY_API_KEY: secret },
      signal: new AbortController().signal,
    };

    await expect(adapters.tavily.search!(request)).rejects
      .toBeInstanceOf(ProviderPayloadError);
    await expect(adapters.tavily.search!(request)).rejects
      .toBeInstanceOf(ProviderPayloadError);

    try {
      await adapters.tavily.search!(request);
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("applies request maxChars to normalized DeepSeek fetch content", async () => {
    const transport = vi.fn().mockResolvedValue(jsonResponse({
      title: "DeepSeek page",
      content: "d".repeat(200),
    }));
    const adapters = createProviderAdapters({ transport });

    const result = await adapters.deepseek.fetch!({
      url: "https://deepseek.test/page",
      maxChars: 100,
      credentials: deepseekConfig.credentials,
      signal: new AbortController().signal,
    });

    expect(Array.from(result.text)).toHaveLength(100);
    expect(result.truncated).toBe(true);
  });

  it("applies request maxChars to normalized Tavily fetch content", async () => {
    const transport = vi.fn().mockResolvedValue(jsonResponse({
      results: [{
        url: "https://tavily.test/page",
        raw_content: "t".repeat(200),
      }],
      failed_results: [],
    }));
    const adapters = createProviderAdapters({ transport });

    const result = await adapters.tavily.fetch!({
      url: "https://tavily.test/page",
      maxChars: 100,
      credentials: allProvidersConfig.credentials,
      signal: new AbortController().signal,
    });

    expect(Array.from(result.text)).toHaveLength(100);
    expect(result.truncated).toBe(true);
  });
});

describe("normalized provider results", () => {
  it("caps normalized search fields, result count, and serialized details", () => {
    const result = normalizeSearchResponse({
      query: '"'.repeat(50_000),
      results: Array.from({ length: 40 }, () => ({
        title: '"'.repeat(10_000),
        url: `https://example.test/${'"'.repeat(10_000)}`,
        snippet: '"'.repeat(10_000),
      })),
    });

    expect(result.results).toHaveLength(20);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(20_000);
  });

  it("caps normalized fetch fields, text, links, and serialized details", () => {
    const result = normalizeFetchResponse({
      url: `https://example.test/${"u".repeat(10_000)}`,
      finalUrl: `https://example.test/${"f".repeat(10_000)}`,
      status: 200,
      title: "t".repeat(10_000),
      text: "b".repeat(60_000),
      links: Array.from({ length: 100 }, () => ({
        text: "l".repeat(1_000),
        href: `https://example.test/${"h".repeat(1_000)}`,
      })),
      truncated: false,
      mode: "provider".repeat(1_000),
    });

    expect(result.text.length).toBeLessThanOrEqual(40_000);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(48_000);
  });

  it("converges non-BMP fetch text under the serialized details cap", () => {
    const originalArrayFrom = Array.from;
    let unicodeTraversals = 0;
    const unicodeTraversalGuard = vi.spyOn(Array, "from").mockImplementation(
      ((value: Iterable<unknown> | ArrayLike<unknown>) => {
        unicodeTraversals += 1;
        if (unicodeTraversals > 8) {
          throw new Error("fetch normalization did not converge");
        }
        return originalArrayFrom(value);
      }) as typeof Array.from
    );
    let result: ReturnType<typeof normalizeFetchResponse>;

    try {
      result = normalizeFetchResponse({
        url: "https://example.test/emoji",
        finalUrl: "https://example.test/emoji",
        status: 200,
        title: "Emoji page",
        text: "😀".repeat(FETCH_BODY_HARD_LIMIT),
        links: [],
        truncated: false,
        mode: "provider",
      });
    } finally {
      unicodeTraversalGuard.mockRestore();
    }

    expect(Array.from(result!.text).length).toBeLessThan(
      FETCH_BODY_HARD_LIMIT
    );
    expect(result!.truncated).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(
      FETCH_DETAILS_HARD_LIMIT
    );
  });

  it("marks fetch results truncated when fixed and link fields are capped", () => {
    const result = normalizeFetchResponse({
      url: `https://example.test/${"u".repeat(1_025)}`,
      finalUrl: `https://example.test/${"f".repeat(1_025)}`,
      status: 200,
      title: "t".repeat(513),
      text: "",
      links: [{
        text: "l".repeat(257),
        href: `https://example.test/${"h".repeat(513)}`,
      }],
      truncated: false,
      mode: "provider".repeat(9),
    });

    expect(result.truncated).toBe(true);
  });
});
