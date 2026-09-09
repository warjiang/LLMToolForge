import { describe, expect, test } from "vitest";
import { resolveToolTransport } from "../model";

/**
 * Routing matrix for the narrow Responses selector. Only the exact upstream id
 * `gpt-6-astra` with function tools present routes to Responses; everything else
 * stays on Chat Completions. See design.md "Minimal Protocol Selection".
 */
describe("resolveToolTransport", () => {
  test("gpt-6-astra with tools -> openai-responses", () => {
    expect(resolveToolTransport("gpt-6-astra", true)).toBe("openai-responses");
  });

  test("gpt-6-astra without tools -> openai-completions", () => {
    expect(resolveToolTransport("gpt-6-astra", false)).toBe(
      "openai-completions"
    );
  });

  test("historical/other models with tools stay on completions", () => {
    for (const model of [
      "gpt-5.6-terra",
      "gpt-5.4-2026-03-05",
      "deepseek-v4",
      "kimi-for-coding-highspeed",
      "some-unknown-model",
    ]) {
      expect(resolveToolTransport(model, true)).toBe("openai-completions");
    }
  });

  test("does not match on prefix/suffix variations", () => {
    for (const model of [
      "gpt-6-astral",
      "gpt-6-astra-preview",
      "prefix-gpt-6-astra",
      "gpt-6",
      "GPT-6-ASTRA",
    ]) {
      expect(resolveToolTransport(model, true)).toBe("openai-completions");
    }
  });

  test("matches the upstream realModel, not a connection-prefixed exposed id", () => {
    // Exposed ids look like `{connName}/{model}`; the selector must be given the
    // resolved upstream realModel, so a prefixed exposed id must NOT match.
    expect(resolveToolTransport("Model-Hub/gpt-6-astra", true)).toBe(
      "openai-completions"
    );
  });
});
