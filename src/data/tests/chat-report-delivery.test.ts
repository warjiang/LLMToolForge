import { afterEach, describe, expect, test } from "vitest";
import { chatRepo } from "@/data/chatRepository";
import {
  DEFAULT_CHAT_SETTINGS,
  normalizeReportDelivery,
  type ChatSessionSettings,
} from "@/types/chat";

const FALLBACK_KEY = "llmtoolforge.chat.sqlite-fallback";

function legacySettings(sessionId: string): ChatSessionSettings {
  return {
    ...DEFAULT_CHAT_SETTINGS,
    sessionId,
    updatedAt: "2026-10-20T00:00:00.000Z",
  };
}

afterEach(() => {
  localStorage.clear();
});

describe("report delivery settings", () => {
  test("normalizes missing, invalid, and HTML delivery values", () => {
    expect(normalizeReportDelivery(undefined)).toBe("chat");
    expect(normalizeReportDelivery("")).toBe("chat");
    expect(normalizeReportDelivery("markdown")).toBe("chat");
    expect(normalizeReportDelivery("HTML")).toBe("chat");
    expect(normalizeReportDelivery("html")).toBe("html");
  });

  test("reads legacy browser fallback settings as chat delivery", async () => {
    const settings = legacySettings("legacy-session");
    const legacy = { ...settings };
    delete (legacy as Partial<ChatSessionSettings>).reportDelivery;
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

    expect((await chatRepo.getSettings(settings.sessionId)).reportDelivery).toBe(
      "chat"
    );
  });

  test("persists a report delivery selection through the browser fallback", async () => {
    const { session } = await chatRepo.createSession("Report delivery");

    await chatRepo.updateSettings(session.id, { reportDelivery: "html" });

    expect((await chatRepo.getSettings(session.id)).reportDelivery).toBe("html");
  });

  test("resets seeded HTML delivery for every new session", async () => {
    const seed = {
      ...legacySettings("seed"),
      modelId: "model-a",
      sandboxMode: "danger-full-access" as const,
      reportDelivery: "html" as const,
    };

    const { settings } = await chatRepo.createSession(
      "New session",
      null,
      seed
    );

    expect(settings).toMatchObject({
      modelId: "model-a",
      sandboxMode: "danger-full-access",
      reportDelivery: "chat",
    });
  });
});
