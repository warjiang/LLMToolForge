import { describe, expect, it } from "vitest";
import type { KeyValueStore } from "@/data/storage";
import { createCreativityHistory } from "@/lib/creativity/history";
import type { CreativityHistoryRecord } from "@/lib/creativity/types";

class MemoryStore implements KeyValueStore {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return (this.values.get(key) as T | undefined) ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }
}

function record(index: number): CreativityHistoryRecord {
  const timestamp = new Date(index).toISOString();
  return {
    id: `round-${index}`,
    mode: "inspiration",
    source: "ai",
    modelId: "gateway/model",
    locale: "zh",
    options: {
      itemCount: 2,
      semanticDistance: "far",
      domain: "any",
      abstraction: "mixed",
      purpose: "divergent",
    },
    prompt: {
      id: `prompt-${index}`,
      items: [
        { text: `thing-${index}`, kind: "thing" },
        { text: `concept-${index}`, kind: "concept" },
      ],
    },
    answer: "",
    hints: [],
    examples: [],
    evaluation: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe("creativity history", () => {
  it("treats legacy records without a source as AI-generated", async () => {
    const store = new MemoryStore();
    const { source: _source, ...legacyRecord } = record(1);
    await store.set("creativityHistory", [legacyRecord]);
    const history = createCreativityHistory(store);

    expect((await history.list())[0]?.source).toBe("ai");
  });

  it("upserts one round and keeps only the newest 50 records", async () => {
    const history = createCreativityHistory(new MemoryStore());
    for (let index = 0; index < 51; index += 1) {
      await history.upsert(record(index));
    }

    expect(await history.list()).toHaveLength(50);
    const newest = (await history.list())[0]!;
    await history.upsert({ ...newest, answer: "updated" });

    expect(await history.list()).toHaveLength(50);
    expect((await history.list())[0]?.answer).toBe("updated");
  });

  it("removes records, clears history, and round-trips settings", async () => {
    const history = createCreativityHistory(new MemoryStore());
    await history.upsert(record(1));
    await history.upsert(record(2));
    await history.remove("round-1");

    expect((await history.list()).map((item) => item.id)).toEqual(["round-2"]);
    const settings = {
      modelId: "gateway/model",
      mode: "training" as const,
      options: record(1).options,
    };
    await history.saveSettings(settings);
    expect(await history.loadSettings()).toEqual(settings);

    await history.clear();
    expect(await history.list()).toEqual([]);
  });
});
