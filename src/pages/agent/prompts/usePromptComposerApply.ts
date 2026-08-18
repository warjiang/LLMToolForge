import { useLayoutEffect, useRef, type RefObject } from "react";
import { applyPromptTemplate } from "@/lib/prompt";
import type { PromptTemplate } from "@/types";

interface PromptComposerApplyOptions {
  input: string;
  onInputChange: (value: string) => void;
  onTitleHintChange: (value: string | undefined) => void;
}

interface PromptComposerApplyResult {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  applyPrompt: (prompt: PromptTemplate) => void;
}

export function usePromptComposerApply({
  input,
  onInputChange,
  onTitleHintChange,
}: PromptComposerApplyOptions): PromptComposerApplyResult {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingSelectionRef = useRef<{
    start: number;
    end: number;
  } | null>(null);

  useLayoutEffect(() => {
    const pending = pendingSelectionRef.current;
    const textarea = textareaRef.current;
    if (!pending || !textarea) return;

    textarea.focus();
    textarea.setSelectionRange(pending.start, pending.end);
    pendingSelectionRef.current = null;
  }, [input]);

  const applyPrompt = (prompt: PromptTemplate) => {
    const textarea = textareaRef.current;
    const applied = applyPromptTemplate(prompt, {
      text: input,
      selectionStart: textarea?.selectionStart ?? input.length,
      selectionEnd: textarea?.selectionEnd ?? input.length,
    });

    pendingSelectionRef.current = {
      start: applied.selectionStart,
      end: applied.selectionEnd,
    };
    onTitleHintChange(applied.titleHint);
    onInputChange(applied.text);
  };

  return { textareaRef, applyPrompt };
}
