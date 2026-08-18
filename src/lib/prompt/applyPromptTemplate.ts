import type { PromptTemplate } from "@/types";

const INPUT_PLACEHOLDER = "{{input}}";

export interface ComposerState {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface AppliedPrompt {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  titleHint?: string;
}

function clampOffset(offset: number, textLength: number): number {
  if (Number.isNaN(offset)) return 0;
  if (offset === Number.POSITIVE_INFINITY) return textLength;
  if (offset === Number.NEGATIVE_INFINITY) return 0;
  return Math.min(textLength, Math.max(0, Math.trunc(offset)));
}

export function applyPromptTemplate(
  template: Pick<PromptTemplate, "content">,
  composer: ComposerState
): AppliedPrompt {
  const { text } = composer;
  const templateText = template.content;
  const firstPlaceholder = templateText.indexOf(INPUT_PLACEHOLDER);

  if (text.trim().length === 0) {
    if (firstPlaceholder >= 0) {
      return {
        text: templateText,
        selectionStart: firstPlaceholder,
        selectionEnd: firstPlaceholder + INPUT_PLACEHOLDER.length,
      };
    }

    return {
      text: templateText,
      selectionStart: templateText.length,
      selectionEnd: templateText.length,
    };
  }

  const titleHint = text.trim();
  if (firstPlaceholder >= 0) {
    const expandedText = templateText.split(INPUT_PLACEHOLDER).join(text);
    return {
      text: expandedText,
      selectionStart: expandedText.length,
      selectionEnd: expandedText.length,
      titleHint,
    };
  }

  const firstOffset = clampOffset(composer.selectionStart, text.length);
  const secondOffset = clampOffset(composer.selectionEnd, text.length);
  const selectionStart = Math.min(firstOffset, secondOffset);
  const selectionEnd = Math.max(firstOffset, secondOffset);
  const appliedText =
    text.slice(0, selectionStart) + templateText + text.slice(selectionEnd);
  const caret = selectionStart + templateText.length;

  return {
    text: appliedText,
    selectionStart: caret,
    selectionEnd: caret,
    titleHint,
  };
}
