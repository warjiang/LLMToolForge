import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BUILTIN_WEB_CONFIG,
  FETCH_BODY_DEFAULT,
  FETCH_BODY_HARD_LIMIT,
  FETCH_DETAILS_HARD_LIMIT,
  FETCH_LINKS_BUDGET,
  FETCH_TEXT_HARD_LIMIT,
  PROVIDER_ERROR_BODY_LIMIT,
  SEARCH_DETAILS_HARD_LIMIT,
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  SEARCH_TEXT_HARD_LIMIT,
  WEB_PROVIDER_CATALOG,
  capSerializedDetails,
  clampFetchBodyChars,
  clampSearchResultCount,
  filterProvidersByCapability,
  normalizeBuiltinWebConfig,
  normalizeProviderOrder,
  parseBuiltinWebConfig,
  truncateUnicode,
} from "./webProviderCatalog";

describe("web provider catalog", () => {
  it("defines the shipped providers and their shared capabilities", () => {
    expect(WEB_PROVIDER_CATALOG.map((provider) => provider.id)).toEqual([
      "deepseek",
      "tavily",
      "local",
    ]);
    expect(WEB_PROVIDER_CATALOG.every((provider) =>
      provider.capabilities.includes("search") &&
      provider.capabilities.includes("fetch")
    )).toBe(true);
    expect(WEB_PROVIDER_CATALOG.find((provider) => provider.id === "local"))
      .toMatchObject({ requiredEnv: [], supportsRender: true });
  });

  it("canonicalizes configured order and keeps local exactly once at the end", () => {
    expect(normalizeProviderOrder([
      "local",
      "tavily",
      "unknown",
      "deepseek",
      "tavily",
    ])).toEqual(["tavily", "deepseek", "local"]);
  });

  it("repairs malformed order without allowing it to remove local", () => {
    expect(normalizeProviderOrder(undefined)).toEqual(
      DEFAULT_BUILTIN_WEB_CONFIG.providerOrder
    );
    expect(normalizeProviderOrder(["unknown", 7, null])).toEqual([
      "deepseek",
      "tavily",
      "local",
    ]);
  });

  it("appends providers introduced after a persisted order before local", () => {
    expect(normalizeProviderOrder(["tavily"])).toEqual([
      "tavily",
      "deepseek",
      "local",
    ]);
  });

  it("filters the catalog by operation capability", () => {
    expect(filterProvidersByCapability("search").map((provider) => provider.id))
      .toEqual(["deepseek", "tavily", "local"]);
  });

  it("normalizes credentials while preserving unknown entries and removing cleared known credentials", () => {
    expect(normalizeBuiltinWebConfig({
      providerOrder: ["local"],
      credentials: {
        DEEPSEEK_API_KEY: "",
        TAVILY_API_KEY: "tavily-key",
        FUTURE_PROVIDER_TOKEN: "keep-me",
        invalid: 9,
      },
    })).toEqual({
      providerOrder: ["deepseek", "tavily", "local"],
      credentials: {
        TAVILY_API_KEY: "tavily-key",
        FUTURE_PROVIDER_TOKEN: "keep-me",
      },
    });
  });

  it("safely parses invalid persisted JSON to the default config", () => {
    expect(parseBuiltinWebConfig("{invalid")).toEqual(DEFAULT_BUILTIN_WEB_CONFIG);
  });
});

describe("web provider bounds", () => {
  it("clamps search result counts and fetch body sizes to their documented bounds", () => {
    expect(clampSearchResultCount(undefined)).toBe(SEARCH_LIMIT_DEFAULT);
    expect(clampSearchResultCount(-4)).toBe(1);
    expect(clampSearchResultCount(99)).toBe(SEARCH_LIMIT_MAX);
    expect(clampFetchBodyChars(undefined)).toBe(FETCH_BODY_DEFAULT);
    expect(clampFetchBodyChars(99_999)).toBe(FETCH_BODY_HARD_LIMIT);
  });

  it("truncates Unicode by code point rather than splitting a surrogate pair", () => {
    expect(truncateUnicode("a😀b", 2)).toBe("a😀");
  });

  it("caps serialized details while retaining valid JSON", () => {
    const details = capSerializedDetails(
      {
        text: "x".repeat(60_000),
        links: Array.from({ length: 100 }, () => ({
          text: "y".repeat(500),
          href: "https://example.test/" + "z".repeat(100),
        })),
      },
      FETCH_DETAILS_HARD_LIMIT
    );

    expect(JSON.stringify(details).length).toBeLessThanOrEqual(
      FETCH_DETAILS_HARD_LIMIT
    );
    expect(() => JSON.parse(JSON.stringify(details))).not.toThrow();
  });

  it("caps large arrays of empty entries without repeated whole-value serialization", () => {
    const stringify = vi.spyOn(JSON, "stringify");

    try {
      const details = capSerializedDetails(
        Array.from({ length: 1_000 }, () => []),
        64
      );
      const serializationCalls = stringify.mock.calls.length;

      expect(JSON.stringify(details).length).toBeLessThanOrEqual(64);
      expect(serializationCalls).toBeLessThan(32);
    } finally {
      stringify.mockRestore();
    }
  });

  it("accepts only JSON-compatible detail values", () => {
    expect(capSerializedDetails({ values: ["safe", false, null] }, 100))
      .toEqual({ values: ["safe", false, null] });

    // @ts-expect-error Date instances are not JSON-compatible detail values.
    capSerializedDetails(new Date(), 100);
  });

  it("exports distinct ceilings for final text, details, links, and provider errors", () => {
    expect(SEARCH_TEXT_HARD_LIMIT).toBe(20_000);
    expect(SEARCH_DETAILS_HARD_LIMIT).toBe(20_000);
    expect(FETCH_TEXT_HARD_LIMIT).toBe(48_000);
    expect(FETCH_LINKS_BUDGET).toBe(6_000);
    expect(PROVIDER_ERROR_BODY_LIMIT).toBe(4_096);
  });
});
