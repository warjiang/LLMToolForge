import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import i18n from "@/i18n/config";
import {
  TOOL_TAB_ORDER,
  ToolsPage,
  loadToolTabOrder,
  normalizeToolTabOrder,
  reorderToolTabOrder,
  resetToolTabOrder,
  saveToolTabOrder,
} from "@/pages/tools/ToolsPage";

describe("ToolsPage tabs", () => {
  beforeEach(() => {
    localStorage.clear();
    void i18n.changeLanguage("zh");
  });

  it("keeps the established tool order", () => {
    const jsonIndex = TOOL_TAB_ORDER.indexOf("json");
    const markdownIndex = TOOL_TAB_ORDER.indexOf("markdown");
    const textEditorIndex = TOOL_TAB_ORDER.indexOf("text-editor");

    expect(jsonIndex).toBeGreaterThanOrEqual(0);
    expect(markdownIndex).toBe(jsonIndex + 1);
    expect(textEditorIndex).toBe(markdownIndex + 1);
    expect(TOOL_TAB_ORDER).toContain("creativity");
  });

  it("normalizes stored tab order by removing unknown values and appending missing tools", () => {
    expect(normalizeToolTabOrder(["hash", "unknown", "url", "hash"])).toEqual([
      "hash",
      "url",
      "json",
      "markdown",
      "text-editor",
      "base64",
      "escape",
      "unicode",
      "creativity",
      "translate",
    ]);
  });

  it("falls back to the default order when no stored tab order exists", () => {
    expect(normalizeToolTabOrder([])).toEqual([...TOOL_TAB_ORDER]);
  });

  it("saves and loads a normalized custom tab order", () => {
    saveToolTabOrder(["translate", "url", "missing"]);

    expect(loadToolTabOrder()).toEqual([
      "translate",
      "url",
      "json",
      "markdown",
      "text-editor",
      "base64",
      "hash",
      "escape",
      "unicode",
      "creativity",
    ]);
  });

  it("resets the stored tab order", () => {
    saveToolTabOrder(["translate", "url"]);
    resetToolTabOrder();

    expect(loadToolTabOrder()).toEqual([...TOOL_TAB_ORDER]);
  });

  it("reorders a tab by active and over values", () => {
    expect(reorderToolTabOrder([...TOOL_TAB_ORDER], "translate", "json")).toEqual([
      "url",
      "translate",
      "json",
      "markdown",
      "text-editor",
      "base64",
      "hash",
      "escape",
      "unicode",
      "creativity",
    ]);
  });

  it("renders a single-line scroll container for the tabs", () => {
    render(React.createElement(ToolsPage));

    expect(screen.getByTestId("tools-tab-scroller").className).toContain("overflow-x-auto");
  });

  it("renders the stored tab order and can reset it", async () => {
    const user = userEvent.setup();
    saveToolTabOrder(["translate", "url"]);
    render(React.createElement(ToolsPage));

    expect(screen.getAllByRole("tab")[0]?.textContent).toContain("翻译");

    await user.click(screen.getByRole("button", { name: "恢复默认顺序" }));

    expect(screen.getAllByRole("tab")[0]?.textContent).toContain("URL 编解码");
    expect(loadToolTabOrder()).toEqual([...TOOL_TAB_ORDER]);
  });
});
