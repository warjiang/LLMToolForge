import { afterEach, describe, expect, test } from "vitest";
import { chatRepo } from "@/data/chatRepository";
import {
  DEFAULT_CHAT_SETTINGS,
  type ChatSessionSettings,
} from "@/types/chat";
import { DATA_AGENT_ID, RESEARCH_AGENT_ID } from "@/lib/agent/builtinAgents";

const FALLBACK_KEY = "llmtoolforge.chat.sqlite-fallback";

function legacySettings(sessionId: string): ChatSessionSettings {
  return {
    ...DEFAULT_CHAT_SETTINGS,
    sessionId,
    updatedAt: "2026-10-21T00:00:00.000Z",
  };
}

afterEach(() => {
  localStorage.clear();
});

describe("chat Web tool source settings", () => {
  test("uses builtin for new General and Research sessions, and off for DataAgent", async () => {
    const general = await chatRepo.createSession("General");
    const research = await chatRepo.createSession(
      "Research",
      RESEARCH_AGENT_ID
    );
    const data = await chatRepo.createSession("Data", DATA_AGENT_ID);

    expect(general.settings.webToolSource).toEqual({ kind: "builtin" });
    expect(research.settings.webToolSource).toEqual({ kind: "builtin" });
    expect(data.settings.webToolSource).toEqual({ kind: "off" });
  });

  test("persists a selected MCP Web source through browser fallback storage", async () => {
    const { session } = await chatRepo.createSession("Source");

    await chatRepo.updateSettings(session.id, {
      webToolSource: { kind: "mcp", serverId: "tavily-mcp" },
    });

    expect((await chatRepo.getSettings(session.id)).webToolSource).toEqual({
      kind: "mcp",
      serverId: "tavily-mcp",
    });
    expect(localStorage.getItem(FALLBACK_KEY)).toContain("tavily-mcp");
  });

  test("migrates legacy bundled Web MCP ids out of generic fallback settings", async () => {
    const settings = legacySettings("legacy-web-mcp");
    const legacy = {
      ...settings,
      enabledMcpServerIds: ["server-a", "builtin-web-fetch"],
    };
    delete (legacy as Partial<ChatSessionSettings>).webToolSource;
    localStorage.setItem(
      FALLBACK_KEY,
      JSON.stringify({
        sessions: [],
        settings: [legacy],
        messages: [],
        parts: [],
        attachments: [],
        toolCalls: [],
        sandboxRuns: [],
      })
    );

    const restored = await chatRepo.getSettings(settings.sessionId);

    expect(restored.webToolSource).toEqual({ kind: "builtin" });
    expect(restored.enabledMcpServerIds).toEqual(["server-a"]);
  });

  test("normalizes malformed persisted sources to off", async () => {
    const settings = legacySettings("malformed-web-source");
    const malformed = {
      ...settings,
      webToolSource: { kind: "mcp", serverId: 42 },
    };
    localStorage.setItem(
      FALLBACK_KEY,
      JSON.stringify({
        sessions: [],
        settings: [malformed],
        messages: [],
        parts: [],
        attachments: [],
        toolCalls: [],
        sandboxRuns: [],
      })
    );

    expect((await chatRepo.getSettings(settings.sessionId)).webToolSource).toEqual(
      { kind: "off" }
    );
  });
});
