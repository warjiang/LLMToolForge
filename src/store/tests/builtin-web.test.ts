import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BUILTIN_WEB_STORAGE_KEY,
  DEFAULT_BUILTIN_WEB_CONFIG,
} from "@/lib/agent/tools/webProviderCatalog";
import { useBuiltinWebStore } from "@/store/builtinWeb";

const initialState = useBuiltinWebStore.getInitialState();

beforeEach(() => {
  localStorage.clear();
  useBuiltinWebStore.setState(initialState, true);
});

afterEach(() => {
  localStorage.clear();
  useBuiltinWebStore.setState(initialState, true);
});

describe("useBuiltinWebStore", () => {
  it("starts with a sensible canonical provider order", () => {
    expect(useBuiltinWebStore.getState().config).toEqual(
      DEFAULT_BUILTIN_WEB_CONFIG
    );
  });

  it("normalizes malformed persisted config without removing local", async () => {
    localStorage.setItem(
      BUILTIN_WEB_STORAGE_KEY,
      JSON.stringify({
        state: {
          config: {
            providerOrder: ["unknown", "local", "local"],
            credentials: null,
          },
        },
      })
    );

    await useBuiltinWebStore.persist.rehydrate();

    expect(useBuiltinWebStore.getState().config).toEqual(
      DEFAULT_BUILTIN_WEB_CONFIG
    );
  });

  it("atomically saves one canonical config and persists it under its dedicated key", () => {
    useBuiltinWebStore.getState().saveConfig({
      providerOrder: ["local", "tavily", "unknown" as never],
      credentials: {
        TAVILY_API_KEY: "tavily-key",
        FUTURE_PROVIDER_TOKEN: "preserve-me",
      },
    });

    expect(useBuiltinWebStore.getState().config).toEqual({
      providerOrder: ["tavily", "deepseek", "local"],
      credentials: {
        TAVILY_API_KEY: "tavily-key",
        FUTURE_PROVIDER_TOKEN: "preserve-me",
      },
    });
    expect(JSON.parse(localStorage.getItem(BUILTIN_WEB_STORAGE_KEY) ?? "{}"))
      .toMatchObject({
        state: {
          config: useBuiltinWebStore.getState().config,
        },
      });
  });

  it("removes a cleared known credential while preserving unknown credential entries", () => {
    useBuiltinWebStore.getState().saveConfig({
      providerOrder: ["deepseek", "tavily", "local"],
      credentials: {
        DEEPSEEK_API_KEY: "",
        TAVILY_API_KEY: "tavily-key",
        FUTURE_PROVIDER_TOKEN: "keep-me",
      },
    });

    expect(useBuiltinWebStore.getState().config.credentials).toEqual({
      TAVILY_API_KEY: "tavily-key",
      FUTURE_PROVIDER_TOKEN: "keep-me",
    });
  });

  it("resets to the default config", () => {
    useBuiltinWebStore.getState().saveConfig({
      providerOrder: ["tavily", "local"],
      credentials: { TAVILY_API_KEY: "tavily-key" },
    });

    useBuiltinWebStore.getState().resetConfig();

    expect(useBuiltinWebStore.getState().config).toEqual(
      DEFAULT_BUILTIN_WEB_CONFIG
    );
  });
});
