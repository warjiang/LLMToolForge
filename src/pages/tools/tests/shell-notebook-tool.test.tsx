import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import i18n from "@/i18n/config";
import { ShellNotebookTool } from "@/pages/tools/ShellNotebookTool";

describe("ShellNotebookTool", () => {
  beforeEach(() => {
    localStorage.clear();
    void i18n.changeLanguage("en");
  });

  it("shows the desktop-only limitation in browser development mode", () => {
    render(<ShellNotebookTool />);

    expect(
      screen.getByText(
        "Shell Notebook runs local Bash commands and is only available in the desktop app.",
      ),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Run all" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows that the Bash session does not load personal rc files", () => {
    render(<ShellNotebookTool />);

    expect(
      screen.getByText(
        "Runs a clean Bash session without personal rc files (--norc --noprofile).",
      ),
    ).not.toBeNull();
  });
});
