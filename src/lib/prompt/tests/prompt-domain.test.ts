import { describe, expect, test } from "vitest";
import type { PromptTemplate } from "@/types";
import {
  applyPromptTemplate,
  normalizePromptInput,
  type ComposerState,
} from "@/lib/prompt";

function prompt(content: string): PromptTemplate {
  return {
    id: "prompt-1",
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    name: "Test prompt",
    description: "",
    content,
    tags: [],
    favorite: false,
  };
}

function composer(
  text: string,
  selectionStart = text.length,
  selectionEnd = selectionStart
): ComposerState {
  return { text, selectionStart, selectionEnd };
}

describe("normalizePromptInput", () => {
  test("normalizes required text fields and reports missing values", () => {
    const result = normalizePromptInput({
      name: "   ",
      description: "  Useful for reviews  ",
      content: "\n\t",
      tags: [],
      favorite: false,
    });

    expect(result.value).toEqual({
      name: "",
      description: "Useful for reviews",
      content: "",
      tags: [],
      favorite: false,
    });
    expect(result.errors).toEqual({
      name: "required",
      content: "required",
    });
    expect(result.isValid).toBe(false);
  });

  test("trims tags and removes empty and case-insensitive duplicates", () => {
    const result = normalizePromptInput({
      name: "  Review  ",
      description: "  Description  ",
      content: "  Analyze this  ",
      tags: [" Work ", "", "work", "  Personal", "PERSONAL ", "TypeScript"],
      sourceUrl: "  https://example.com/prompt  ",
      favorite: true,
    });

    expect(result.value).toEqual({
      name: "Review",
      description: "Description",
      content: "Analyze this",
      tags: ["Work", "Personal", "TypeScript"],
      sourceUrl: "https://example.com/prompt",
      favorite: true,
    });
    expect(result.errors).toEqual({});
    expect(result.isValid).toBe(true);
  });

  test.each(["http://example.com", "https://example.com/path"])(
    "accepts the supported source URL protocol: %s",
    (sourceUrl) => {
      const result = normalizePromptInput({
        name: "Prompt",
        description: "",
        content: "Body",
        tags: [],
        sourceUrl,
        favorite: false,
      });

      expect(result.value.sourceUrl).toBe(sourceUrl);
      expect(result.errors.sourceUrl).toBeUndefined();
      expect(result.isValid).toBe(true);
    }
  );

  test.each([
    "ftp://example.com/prompt",
    "file:///tmp/prompt",
    "javascript:alert(1)",
    "example.com/prompt",
    "https://",
  ])("rejects an unsupported or malformed source URL: %s", (sourceUrl) => {
    const result = normalizePromptInput({
      name: "Prompt",
      description: "",
      content: "Body",
      tags: [],
      sourceUrl,
      favorite: false,
    });

    expect(result.value.sourceUrl).toBe(sourceUrl);
    expect(result.errors.sourceUrl).toBe("invalid_url");
    expect(result.isValid).toBe(false);
  });

  test("removes an empty optional source URL after trimming", () => {
    const result = normalizePromptInput({
      name: "Prompt",
      description: "",
      content: "Body",
      tags: [],
      sourceUrl: "   ",
      favorite: false,
    });

    expect(result.value).not.toHaveProperty("sourceUrl");
    expect(result.isValid).toBe(true);
  });
});

describe("applyPromptTemplate", () => {
  test("replaces a whitespace-only composer and puts the caret at the end", () => {
    const result = applyPromptTemplate(
      prompt("Analyze carefully"),
      composer(" \n\t", 1, 2)
    );

    expect(result).toEqual({
      text: "Analyze carefully",
      selectionStart: 17,
      selectionEnd: 17,
    });
  });

  test("selects the first placeholder when the composer is empty", () => {
    const result = applyPromptTemplate(
      prompt("Before {{input}}\nAfter {{input}}"),
      composer("")
    );

    expect(result).toEqual({
      text: "Before {{input}}\nAfter {{input}}",
      selectionStart: 7,
      selectionEnd: 16,
    });
  });

  test("replaces every placeholder with the entire original composer text", () => {
    const result = applyPromptTemplate(
      prompt("Question:\n{{input}}\nAgain: {{input}}"),
      composer("  Why now?\nSecond line  ", 2, 8)
    );

    expect(result).toEqual({
      text:
        "Question:\n  Why now?\nSecond line  \nAgain:   Why now?\nSecond line  ",
      selectionStart: 66,
      selectionEnd: 66,
      titleHint: "Why now?\nSecond line",
    });
  });

  test("placeholder replacement is independent of an active selection", () => {
    const selected = applyPromptTemplate(
      prompt("Wrap {{input}}"),
      composer("original draft", 0, 14)
    );
    const caretAtEnd = applyPromptTemplate(
      prompt("Wrap {{input}}"),
      composer("original draft")
    );

    expect(selected).toEqual(caretAtEnd);
    expect(selected.text).toBe("Wrap original draft");
  });

  test("replaces the active selection with a placeholder-free template", () => {
    const result = applyPromptTemplate(
      prompt("[inserted]"),
      composer("Keep OLD tail", 5, 8)
    );

    expect(result).toEqual({
      text: "Keep [inserted] tail",
      selectionStart: 15,
      selectionEnd: 15,
      titleHint: "Keep OLD tail",
    });
  });

  test("sorts and clamps selection offsets before insertion", () => {
    const result = applyPromptTemplate(
      prompt("X"),
      composer("abcd", 99, -3)
    );

    expect(result.text).toBe("X");
    expect(result.selectionStart).toBe(1);
    expect(result.selectionEnd).toBe(1);
  });

  test("uses JavaScript UTF-16 offsets for multiline Unicode selections", () => {
    const result = applyPromptTemplate(
      prompt("line 1\n😀"),
      composer("A😀B\n尾", 1, 3)
    );

    expect(result).toEqual({
      text: "Aline 1\n😀B\n尾",
      selectionStart: 10,
      selectionEnd: 10,
      titleHint: "A😀B\n尾",
    });
  });
});
