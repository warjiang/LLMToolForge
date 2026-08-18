import { describe, expect, it } from "vitest";
import type { PromptTemplate } from "@/types";
import {
  buildPromptSections,
  filterPrompts,
} from "@/pages/agent/prompts/promptList";

function prompt(
  id: string,
  name: string,
  overrides: Partial<PromptTemplate> = {}
): PromptTemplate {
  return {
    id,
    name,
    description: "",
    content: "",
    tags: [],
    favorite: false,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("filterPrompts", () => {
  it("searches name, description, and tags case-insensitively but never content", () => {
    const prompts = [
      prompt("name", "Release CHECKLIST"),
      prompt("description", "Description match", {
        description: "Use for a release checklist",
      }),
      prompt("tag", "Tag match", { tags: ["Release"] }),
      prompt("body", "Body only", { content: "release checklist" }),
    ];

    expect(filterPrompts(prompts, "rElEaSe").map((item) => item.id)).toEqual([
      "description",
      "name",
      "tag",
    ]);
  });

  it("orders filtered results by favorite first and then localeCompare name", () => {
    const prompts = [
      prompt("z", "Zulu", { description: "match" }),
      prompt("b", "Bravo", { description: "match", favorite: true }),
      prompt("a", "Alpha", { description: "match", favorite: true }),
      prompt("c", "Charlie", { description: "match" }),
    ];

    expect(filterPrompts(prompts, "match").map((item) => item.id)).toEqual([
      "a",
      "b",
      "c",
      "z",
    ]);
  });
});

describe("buildPromptSections", () => {
  it("projects favorites, recent prompts, and remaining prompts without duplicate rows", () => {
    const prompts = [
      prompt("recent", "Recent"),
      prompt("favorite", "Favorite", { favorite: true }),
      prompt("remaining", "Remaining"),
    ];

    const sections = buildPromptSections(prompts, [
      "favorite",
      "missing",
      "recent",
    ]);

    expect(sections.favorites.map((item) => item.id)).toEqual(["favorite"]);
    expect(sections.recent.map((item) => item.id)).toEqual(["recent"]);
    expect(sections.remaining.map((item) => item.id)).toEqual(["remaining"]);
    expect(
      [
        ...sections.favorites,
        ...sections.recent,
        ...sections.remaining,
      ].map((item) => item.id)
    ).toEqual(["favorite", "recent", "remaining"]);
  });
});
