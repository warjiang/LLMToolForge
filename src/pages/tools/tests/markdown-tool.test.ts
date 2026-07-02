import {
  clampMarkdownInputPaneWidth,
  MARKDOWN_DEFAULT_INPUT_WIDTH,
  MARKDOWN_MIN_PANE_WIDTH,
  MARKDOWN_TOOL_LAYOUT,
} from "@/lib/markdownTool";

export function runMarkdownToolTests() {
  console.assert(
    MARKDOWN_TOOL_LAYOUT.root.includes("h-full") &&
      MARKDOWN_TOOL_LAYOUT.root.includes("min-h-0"),
    "markdown tool root should fill and shrink within the available height"
  );
  console.assert(
    MARKDOWN_TOOL_LAYOUT.panes.includes("min-h-0") &&
      MARKDOWN_TOOL_LAYOUT.panes.includes("md:flex-1"),
    "markdown tool panes should reserve the remaining vertical space"
  );
  console.assert(
    MARKDOWN_TOOL_LAYOUT.editor.includes("flex-1") &&
      MARKDOWN_TOOL_LAYOUT.editor.includes("md:min-h-0"),
    "markdown input should expand to the available pane height"
  );
  console.assert(
    MARKDOWN_TOOL_LAYOUT.preview.includes("flex-1") &&
      MARKDOWN_TOOL_LAYOUT.preview.includes("overflow-auto"),
    "markdown preview should scroll when rendered content exceeds the pane"
  );
  console.assert(
    MARKDOWN_DEFAULT_INPUT_WIDTH === 0.5,
    "markdown split view should start from a balanced 50/50 width"
  );
  console.assert(
    MARKDOWN_MIN_PANE_WIDTH === 280,
    "markdown split view should clamp panes to a readable minimum width"
  );
  console.assert(
    MARKDOWN_TOOL_LAYOUT.handle.includes("cursor-col-resize") &&
      MARKDOWN_TOOL_LAYOUT.handle.includes("hidden md:flex"),
    "markdown split view should expose a desktop-only drag handle"
  );
  console.assert(
    clampMarkdownInputPaneWidth(120, 900) === MARKDOWN_MIN_PANE_WIDTH,
    "dragging narrower than the minimum should clamp to the minimum pane width"
  );
  console.assert(
    clampMarkdownInputPaneWidth(780, 900) === 620,
    "dragging wider than the available space should preserve the preview minimum width"
  );
  console.assert(
    clampMarkdownInputPaneWidth(420, 900) === 420,
    "valid drag widths should pass through unchanged"
  );
}
