import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import i18n from "@/i18n/config";
import { McpDialog } from "@/pages/mcp/McpDialog";
import type { McpServer } from "@/types";

const webMcp: McpServer = {
  id: "web-mcp",
  name: "Company Web",
  transport: "http",
  url: "https://mcp.example.test",
  args: [],
  env: {},
  enabled: true,
  installed: true,
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
};

describe("MCP Web source candidate", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("allows a user MCP server to be marked as a Web tool source", () => {
    render(<McpDialog open onOpenChange={() => undefined} editing={webMcp} />);

    expect(
      screen.getByRole("switch", { name: "Web tool source candidate" })
    ).toBeTruthy();
  });
});
