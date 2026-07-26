import { describe, expect, it } from "vitest";
import {
  buildEvaluationMessages,
  buildPromptMessages,
} from "@/lib/creativity/prompts";
import {
  parseCreativityEvaluation,
  parseCreativityExamples,
  parseCreativityPrompt,
} from "@/lib/creativity/parser";

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
  });

  it("rejects duplicate prompt items after normalization", () => {
    expect(() =>
      parseCreativityPrompt(
        '{"items":[{"text":"Clock","kind":"thing"},{"text":" clock ","kind":"thing"}]}',
        2,
      ),
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
});
