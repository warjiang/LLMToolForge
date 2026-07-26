import { describe, expect, it } from "vitest";
import { TOOL_TAB_ORDER } from "@/pages/tools/ToolsPage";

describe("ToolsPage tabs", () => {
  it("keeps the established tool order", () => {
    const jsonIndex = TOOL_TAB_ORDER.indexOf("json");
    const markdownIndex = TOOL_TAB_ORDER.indexOf("markdown");
    const textEditorIndex = TOOL_TAB_ORDER.indexOf("text-editor");

    expect(jsonIndex).toBeGreaterThanOrEqual(0);
    expect(markdownIndex).toBe(jsonIndex + 1);
    expect(textEditorIndex).toBe(markdownIndex + 1);
  });
});
