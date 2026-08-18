import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { usePromptComposerApply } from "@/pages/agent/prompts/usePromptComposerApply";
import type { PromptTemplate } from "@/types";

const prompt: PromptTemplate = {
  id: "prompt-1",
  name: "Wrap",
  description: "",
  content: "Before {{input}}",
  tags: [],
  favorite: false,
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
};

function ComposerHarness() {
  const [input, setInput] = useState("");
  const [titleHint, setTitleHint] = useState<string | undefined>();
  const { textareaRef, applyPrompt } = usePromptComposerApply({
    input,
    onInputChange: setInput,
    onTitleHintChange: setTitleHint,
  });

  return (
    <>
      <textarea
        ref={textareaRef}
        aria-label="Composer"
        value={input}
        onChange={(event) => setInput(event.target.value)}
      />
      <button type="button" onClick={() => applyPrompt(prompt)}>
        Apply
      </button>
      <output>{titleHint ?? ""}</output>
    </>
  );
}

describe("usePromptComposerApply", () => {
  it("writes the template result and selects an empty-composer placeholder", () => {
    render(<ComposerHarness />);

    act(() => {
      screen.getByRole("button", { name: "Apply" }).click();
    });

    const composer = screen.getByRole("textbox", { name: "Composer" });
    expect((composer as HTMLTextAreaElement).value).toBe("Before {{input}}");
    expect(document.activeElement).toBe(composer);
    expect((composer as HTMLTextAreaElement).selectionStart).toBe(7);
    expect((composer as HTMLTextAreaElement).selectionEnd).toBe(16);
  });
});
