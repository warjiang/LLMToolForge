import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promptTemplateRepo } from "@/data/repositories";
import {
  projectRecentPrompts,
  recordRecentPromptId,
  usePromptRecentStore,
} from "@/store/promptRecent";
import type { PromptTemplate } from "@/types";

const initialRecentState = usePromptRecentStore.getInitialState();

function prompt(
  id: string,
  favorite = false,
  updatedAt = "2026-08-18T00:00:00.000Z"
): PromptTemplate {
  return {
    id,
    name: `Prompt ${id}`,
    description: "",
    content: id,
    tags: [],
    favorite,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt,
  };
}

beforeEach(() => {
  usePromptRecentStore.setState(initialRecentState, true);
});

afterEach(() => {
  usePromptRecentStore.setState(initialRecentState, true);
  vi.restoreAllMocks();
});

describe("recordRecentPromptId", () => {
  it("moves an existing id to the front without duplicates", () => {
    expect(recordRecentPromptId(["a", "b", "c"], "b")).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("caps recent ids at five", () => {
    expect(recordRecentPromptId(["a", "b", "c", "d", "e"], "f")).toEqual([
      "f",
      "a",
      "b",
      "c",
      "d",
    ]);
  });
});

describe("projectRecentPrompts", () => {
  it("preserves MRU order while filtering missing and favorite prompts", () => {
    const prompts = [prompt("a"), prompt("b", true), prompt("c")];

    expect(
      projectRecentPrompts(["missing", "c", "b", "a"], prompts).map(
        (item) => item.id
      )
    ).toEqual(["c", "a"]);
  });
});

describe("usePromptRecentStore", () => {
  it("records and projects the same PromptTemplate without updating it", () => {
    const update = vi.spyOn(promptTemplateRepo, "update");
    const original = prompt("a", false, "2026-08-18T01:00:00.000Z");
    const originalUpdatedAt = original.updatedAt;

    usePromptRecentStore.getState().recordRecent(original.id);
    const projected = projectRecentPrompts(
      usePromptRecentStore.getState().recentPromptIds,
      [original]
    );

    expect(projected).toHaveLength(1);
    expect(projected[0]).toBe(original);
    expect(projected[0]?.updatedAt).toBe(originalUpdatedAt);
    expect(update).not.toHaveBeenCalled();
  });

  it("writes no persistence data and resets to its initial in-memory state", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    usePromptRecentStore.getState().recordRecent("a");

    expect(setItem).not.toHaveBeenCalled();
    expect("persist" in usePromptRecentStore).toBe(false);
    usePromptRecentStore.setState(
      usePromptRecentStore.getInitialState(),
      true
    );
    expect(usePromptRecentStore.getState().recentPromptIds).toEqual([]);
  });
});
