import { describe, expect, it, vi } from "vitest";
import {
  createCreativityClient,
  selectCreativityModel,
} from "@/lib/creativity/client";
import type { ExposedModel } from "@/lib/unifiedApi";

function model(
  id: string,
  features: ExposedModel["features"] = [],
): ExposedModel {
  return {
    id,
    realModel: id,
    provider: "manual",
    baseUrl: "https://upstream.example/v1",
    apiKey: "secret",
    connId: "key:test",
    connName: "Test",
    features,
  };
}

describe("creativity client", () => {
  it("restores the preferred enabled text model", () => {
    expect(
      selectCreativityModel(
        [model("a"), model("b"), model("image", ["image-gen"])],
        new Set(["a"]),
        "b",
      )?.id,
    ).toBe("b");
  });

  it("falls back to the first available text model", () => {
    expect(
      selectCreativityModel(
        [model("image", ["image-gen"]), model("b")],
        new Set(),
        "missing",
      )?.id,
    ).toBe("b");
  });

  it("retries once when the first response has invalid JSON", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce("not json")
      .mockResolvedValueOnce(
        '{"items":[{"text":"雨伞","kind":"thing"},{"text":"区块链","kind":"concept"}]}',
      );
    const client = createCreativityClient({ complete });

    const result = await client.generatePrompt("model", {
      locale: "zh",
      options: {
        itemCount: 2,
        semanticDistance: "far",
        domain: "any",
        abstraction: "mixed",
        purpose: "divergent",
      },
    });

    expect(result.items).toHaveLength(2);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("does not repair transport failures", async () => {
    const complete = vi.fn().mockRejectedValue(new Error("offline"));
    const client = createCreativityClient({ complete });

    await expect(
      client.generatePrompt("model", {
        locale: "en",
        options: {
          itemCount: 2,
          semanticDistance: "cross-domain",
          domain: "any",
          abstraction: "mixed",
          purpose: "divergent",
        },
      }),
    ).rejects.toThrow("offline");
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
