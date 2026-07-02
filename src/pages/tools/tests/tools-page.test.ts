import { TOOL_TAB_ORDER } from "@/pages/tools/ToolsPage";

export function runToolsPageTests() {
  const jsonIndex = TOOL_TAB_ORDER.indexOf("json");
  const markdownIndex = TOOL_TAB_ORDER.indexOf("markdown");
  const textEditorIndex = TOOL_TAB_ORDER.indexOf("text-editor");

  console.assert(jsonIndex !== -1, "tools tabs should include json");
  console.assert(markdownIndex !== -1, "tools tabs should include markdown");
  console.assert(textEditorIndex !== -1, "tools tabs should include text editor");
  console.assert(
    markdownIndex === jsonIndex + 1,
    "markdown should appear immediately after json"
  );
  console.assert(
    textEditorIndex === markdownIndex + 1,
    "text editor should appear immediately after markdown"
  );
}
