export const MARKDOWN_DEFAULT_INPUT_WIDTH = 0.5;
export const MARKDOWN_MIN_PANE_WIDTH = 280;

export function clampMarkdownInputPaneWidth(width: number, containerWidth: number): number {
  const maxWidth = Math.max(
    MARKDOWN_MIN_PANE_WIDTH,
    containerWidth - MARKDOWN_MIN_PANE_WIDTH
  );
  return Math.min(Math.max(width, MARKDOWN_MIN_PANE_WIDTH), maxWidth);
}

export const MARKDOWN_TOOL_LAYOUT = {
  root: "flex h-full min-h-0 flex-col gap-4 overflow-auto md:overflow-hidden",
  panes: "flex min-h-0 flex-col gap-4 md:flex-1 md:flex-row md:gap-0",
  pane: "flex min-h-[320px] flex-col gap-1.5 md:min-h-0",
  leftPane: "md:min-w-0 md:shrink-0 md:basis-[var(--markdown-input-width)]",
  rightPane: "md:min-w-[280px] md:flex-1",
  handle: "hidden md:flex md:mx-2",
  editor: "min-h-[320px] flex-1 resize-y font-mono text-copy-13 leading-relaxed md:min-h-0",
  preview:
    "min-h-[320px] flex-1 overflow-auto rounded-md border border-border bg-background-secondary px-4 py-3 md:min-h-0",
} as const;
