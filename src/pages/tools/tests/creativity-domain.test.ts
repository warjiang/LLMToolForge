import { describe, expect, it } from "vitest";
import {
  buildEvaluationMessages,
  buildPromptMessages,
} from "@/lib/creativity/prompts";
import {
  createCreativityPrompt,
  parseCreativityEvaluation,
  parseCreativityExamples,
  parseCreativityPrompt,
} from "@/lib/creativity/parser";
import {
  createInitialCreativityState,
  creativityReducer,
} from "@/pages/tools/creativity/state";

describe("creativity domain", () => {
  it("includes every prompt control and the output language", () => {
    const messages = buildPromptMessages({
      locale: "zh",
      options: {
        itemCount: 3,
        semanticDistance: "far",
        domain: "technology",
        abstraction: "mixed",
        purpose: "product",
      },
    });
    const text = messages.map((message) => message.content).join("\n");

    expect(text).toContain("3");
    expect(text).toContain("far");
    expect(text).toContain("technology");
    expect(text).toContain("mixed");
    expect(text).toContain("product");
    expect(text).toContain("简体中文");
    expect(text).toContain("short noun or concept phrase");
  });

  it("rejects duplicate prompt items after normalization", () => {
    expect(() =>
      parseCreativityPrompt(
        '{"items":[{"text":"Clock","kind":"thing"},{"text":" clock ","kind":"thing"}]}',
        2,
      ),
    ).toThrow(/duplicate/i);
  });

  it("accepts six short independent concepts", () => {
    const result = parseCreativityPrompt(
      '{"items":[{"text":"雨伞","kind":"thing"},{"text":"信任","kind":"concept"},{"text":"珊瑚","kind":"thing"},{"text":"节奏","kind":"concept"},{"text":"电池","kind":"thing"},{"text":"迁徙","kind":"concept"}]}',
      6,
    );

    expect(result.items).toHaveLength(6);
  });

  it("rejects questions and task instructions as combination items", () => {
    expect(() =>
      parseCreativityPrompt(
        '{"items":[{"text":"结合雨伞与手电筒的功能，列出至少十种新产品形态","kind":"concept"},{"text":"森林","kind":"thing"}]}',
        2,
      ),
    ).toThrow(/short phrase/i);
    expect(() =>
      parseCreativityPrompt(
        '{"items":[{"text":"如何让雨伞更智能","kind":"concept"},{"text":"森林","kind":"thing"}]}',
        2,
      ),
    ).toThrow(/short phrase/i);
  });

  it("rejects empty and duplicate custom combination items", () => {
    expect(() => createCreativityPrompt(["雨伞", ""], 2)).toThrow(
      /short phrase/i,
    );
    expect(() =>
      createCreativityPrompt(["Clock", " clock "], 2),
    ).toThrow(/duplicate/i);
  });

  it("requires three examples with distinct methods", () => {
    expect(() =>
      parseCreativityExamples(
        '{"examples":[{"method":"类比","title":"A","content":"x"},{"method":"类比","title":"B","content":"y"},{"method":"叙事","title":"C","content":"z"}]}',
      ),
    ).toThrow(/method/i);
  });

  it("requires all four evaluation dimensions", () => {
    const messages = buildEvaluationMessages({
      locale: "zh",
      promptItems: ["雨伞", "区块链"],
      answer: "用分布式所有权共享公共雨伞。",
    });

    expect(messages[1]?.content).toContain("分布式所有权");
    expect(() => parseCreativityEvaluation('{"dimensions":{}}')).toThrow(
      /distance/i,
    );
  });

  it("ignores a response from an obsolete round", () => {
    const initial = createInitialCreativityState();
    const loading = creativityReducer(initial, {
      type: "operation-started",
      operation: "prompt",
      roundId: "round-a",
    });
    const nextRound = creativityReducer(loading, {
      type: "round-reset",
      roundId: "round-b",
    });
    const stale = creativityReducer(nextRound, {
      type: "prompt-succeeded",
      roundId: "round-a",
      prompt: { id: "old", items: [] },
      source: "ai",
    });

    expect(stale.prompt).toBeNull();
    expect(stale.roundId).toBe("round-b");
  });

  it("keeps the prompt and answer when an operation fails", () => {
    const state = {
      ...createInitialCreativityState(),
      roundId: "round-a",
      prompt: {
        id: "prompt",
        items: [
          { text: "雨伞", kind: "thing" as const },
          { text: "区块链", kind: "concept" as const },
        ],
      },
      answer: "共享雨伞所有权",
    };
    const failed = creativityReducer(state, {
      type: "operation-failed",
      roundId: "round-a",
      message: "invalid JSON",
    });

    expect(failed.prompt).toEqual(state.prompt);
    expect(failed.answer).toBe(state.answer);
    expect(failed.error).toBe("invalid JSON");
  });

  it("keeps the prompt but clears mode-specific results", () => {
    const state = {
      ...createInitialCreativityState(),
      prompt: {
        id: "prompt",
        items: [
          { text: "雨伞", kind: "thing" as const },
          { text: "区块链", kind: "concept" as const },
        ],
      },
      examples: [{ method: "类比", title: "A", content: "B" }],
      answer: "draft",
      answerDirty: true,
    };
    const changed = creativityReducer(state, {
      type: "mode-changed",
      mode: "training",
    });

    expect(changed.prompt).toEqual(state.prompt);
    expect(changed.mode).toBe("training");
    expect(changed.examples).toEqual([]);
    expect(changed.answer).toBe("");
    expect(changed.answerDirty).toBe(false);
  });

  it("ignores an old-mode response after switching modes", () => {
    const initial = {
      ...createInitialCreativityState(),
      roundId: "round-inspiration",
      prompt: {
        id: "prompt",
        items: [
          { text: "雨伞", kind: "thing" as const },
          { text: "区块链", kind: "concept" as const },
        ],
      },
    };
    const loading = creativityReducer(initial, {
      type: "operation-started",
      operation: "examples",
      roundId: "round-inspiration",
    });
    const changed = creativityReducer(loading, {
      type: "mode-changed",
      mode: "training",
    });
    const stale = creativityReducer(changed, {
      type: "examples-succeeded",
      roundId: "round-inspiration",
      examples: [{ method: "类比", title: "旧结果", content: "不应出现" }],
    });

    expect(changed.roundId).not.toBe("round-inspiration");
    expect(stale.examples).toEqual([]);
  });

  it("resizes the custom draft while preserving leading values", () => {
    const custom = creativityReducer(createInitialCreativityState(), {
      type: "source-changed",
      source: "custom",
    });
    const filled = creativityReducer(custom, {
      type: "custom-item-changed",
      index: 0,
      value: "雨伞",
    });
    const resized = creativityReducer(filled, {
      type: "options-changed",
      options: { ...filled.options, itemCount: 4 },
    });

    expect(resized.customItems).toEqual(["雨伞", "", "", ""]);
  });
});
