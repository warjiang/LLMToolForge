import type { PromptTemplate } from "@/types";

export type PromptInput = Pick<
  PromptTemplate,
  "name" | "description" | "content" | "tags" | "sourceUrl" | "favorite"
>;

export type PromptValidationField = "name" | "content" | "sourceUrl";
export type PromptValidationErrorCode = "required" | "invalid_url";
export type PromptValidationErrors = Partial<
  Record<PromptValidationField, PromptValidationErrorCode>
>;

export interface PromptValidationResult {
  value: PromptInput;
  errors: PromptValidationErrors;
  isValid: boolean;
}

function normalizeTags(tags: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const tag of tags) {
    const value = tag.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;

    seen.add(key);
    normalized.push(value);
  }

  return normalized;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizePromptInput(
  input: PromptInput
): PromptValidationResult {
  const sourceUrl = input.sourceUrl?.trim();
  const value: PromptInput = {
    name: input.name.trim(),
    description: input.description.trim(),
    content: input.content.trim(),
    tags: normalizeTags(input.tags),
    favorite: input.favorite,
    ...(sourceUrl ? { sourceUrl } : {}),
  };
  const errors: PromptValidationErrors = {};

  if (!value.name) errors.name = "required";
  if (!value.content) errors.content = "required";
  if (sourceUrl && !isHttpUrl(sourceUrl)) errors.sourceUrl = "invalid_url";

  return {
    value,
    errors,
    isValid: Object.keys(errors).length === 0,
  };
}
