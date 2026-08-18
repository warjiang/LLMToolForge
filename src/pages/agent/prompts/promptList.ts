import { projectRecentPrompts } from "@/store/promptRecent";
import type { PromptTemplate } from "@/types";

export interface PromptSections {
  favorites: PromptTemplate[];
  recent: PromptTemplate[];
  remaining: PromptTemplate[];
}

export function comparePrompts(
  left: PromptTemplate,
  right: PromptTemplate
): number {
  if (left.favorite !== right.favorite) {
    return left.favorite ? -1 : 1;
  }
  return left.name.localeCompare(right.name);
}

export function filterPrompts(
  prompts: readonly PromptTemplate[],
  query: string
): PromptTemplate[] {
  const normalizedQuery = query.trim().toLowerCase();
  return prompts
    .filter((prompt) => {
      if (!normalizedQuery) return true;
      return [prompt.name, prompt.description, ...prompt.tags].some((value) =>
        value.toLowerCase().includes(normalizedQuery)
      );
    })
    .sort(comparePrompts);
}

export function buildPromptSections(
  prompts: readonly PromptTemplate[],
  recentPromptIds: readonly string[]
): PromptSections {
  const favorites = prompts.filter((prompt) => prompt.favorite).sort(comparePrompts);
  const recent = projectRecentPrompts(recentPromptIds, prompts);
  const shownIds = new Set(
    [...favorites, ...recent].map((prompt) => prompt.id)
  );
  const remaining = prompts
    .filter((prompt) => !shownIds.has(prompt.id))
    .sort(comparePrompts);

  return { favorites, recent, remaining };
}
