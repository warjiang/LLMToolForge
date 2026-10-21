import { beforeEach, describe, expect, test, vi } from "vitest";

const database = vi.hoisted(() => ({
  execute: vi.fn(async () => undefined),
  select: vi.fn(async (sql: string) => {
    if (sql.startsWith("PRAGMA table_info")) {
      return sql.includes("session_settings")
        ? []
        : [{ name: "web_tool_source" }];
    }
    if (sql.includes("LEFT JOIN session_settings")) {
      return [
        {
          session_id: "session-1",
          session_agent_id: null,
          conn_key: null,
          model_id: "",
          key_idx: "0",
          wire_format: "openai-chat",
          system: "",
          temperature: "0.7",
          max_tokens: "1024",
          streaming: 1,
          enabled_skill_ids: "[]",
          enabled_mcp_server_ids: "[]",
          web_tool_source: JSON.stringify({
            kind: "mcp",
            serverId: "company-web",
          }),
          report_delivery: "chat",
          sandbox_mode: "workspace-write",
          auto_approve_checkpoints: 0,
          workspace_path: "",
          connector_enabled: 0,
          updated_at: "2026-10-21T00:00:00.000Z",
        },
      ];
    }
    return [];
  }),
}));

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    load: vi.fn(async () => database),
  },
}));

import { chatRepo } from "@/data/chatRepository";

describe("chat Web tool source SQLite persistence", () => {
  beforeEach(() => {
    database.execute.mockClear();
    database.select.mockClear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  test("migrates the SQLite column and decodes a persisted MCP source", async () => {
    const settings = await chatRepo.getSettings("session-1");

    expect(settings.webToolSource).toEqual({
      kind: "mcp",
      serverId: "company-web",
    });
    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("ADD COLUMN web_tool_source TEXT")
    );
  });
});
