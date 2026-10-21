import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/config";
import { WebToolSourceSelector } from "@/pages/agent/WebToolSourceSelector";

describe("WebToolSourceSelector", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("offers built-in, eligible MCP, and off sources", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <WebToolSourceSelector
        value={{ kind: "builtin" }}
        candidates={[
          {
            id: "company-web",
            name: "Company Web",
            enabled: true,
            installed: true,
            webToolSourceCandidate: true,
          },
        ]}
        onChange={onChange}
      />
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Web tool source" }),
      "mcp:company-web"
    );

    expect(onChange).toHaveBeenCalledWith({
      kind: "mcp",
      serverId: "company-web",
    });
    expect(screen.getByRole("option", { name: "Built-in Web Tools" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Off" })).toBeTruthy();
  });

  it("clears an unavailable MCP source instead of retaining stale selection", () => {
    const onChange = vi.fn();
    render(
      <WebToolSourceSelector
        value={{ kind: "mcp", serverId: "removed-web" }}
        candidates={[]}
        onChange={onChange}
      />
    );

    expect(onChange).toHaveBeenCalledWith({ kind: "off" });
  });

  it("uses an inline control without a visible form label in the toolbar", () => {
    render(
      <WebToolSourceSelector
        value={{ kind: "builtin" }}
        candidates={[]}
        layout="toolbar"
        onChange={vi.fn()}
      />
    );

    expect(
      screen.getByRole("combobox", { name: "Web tool source" })
    ).toBeTruthy();
    expect(screen.queryByText("Web tool source")).toBeNull();
  });
});
