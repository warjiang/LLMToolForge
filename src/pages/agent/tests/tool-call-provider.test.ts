import { describe, expect, it } from "vitest";
import { webToolProviderLabel } from "../toolCallProvider";

describe("webToolProviderLabel", () => {
  it("names the provider used by an internal Web tool result", () => {
    expect(
      webToolProviderLabel("web_search", { provider: "deepseek" })
    ).toBe("DeepSeek");
    expect(
      webToolProviderLabel("web_fetch", { provider: "local", mode: "render" })
    ).toBe("Local");
  });

  it("does not infer a provider for other tools or untrusted details", () => {
    expect(webToolProviderLabel("mcp__company__search", {
      provider: "tavily",
    })).toBeNull();
    expect(webToolProviderLabel("web_search", { provider: "other" })).toBeNull();
  });
});
