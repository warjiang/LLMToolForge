import { create } from "zustand";
import type { PromptTemplate } from "@/types";

const MAX_RECENT_PROMPTS = 5;

export function recordRecentPromptId(
  recentPromptIds: readonly string[],
  id: string
): string[] {
  return [id, ...recentPromptIds.filter((recentId) => recentId !== id)].slice(
    0,
    MAX_RECENT_PROMPTS
  );
}

export function projectRecentPrompts(
  recentPromptIds: readonly string[],
  prompts: readonly PromptTemplate[]
): PromptTemplate[] {
  const promptsById = new Map(prompts.map((prompt) => [prompt.id, prompt]));
  return recentPromptIds.flatMap((id) => {
    const prompt = promptsById.get(id);
    return prompt && !prompt.favorite ? [prompt] : [];
  });
}

interface PromptRecentState {
  recentPromptIds: string[];
  recordRecent: (id: string) => void;
}

export const usePromptRecentStore = create<PromptRecentState>((set) => ({
  recentPromptIds: [],
  recordRecent: (id) =>
    set((state) => ({
      recentPromptIds: recordRecentPromptId(state.recentPromptIds, id),
    })),
}));
