import { afterEach, describe, expect, it, vi } from "vitest";
import { chatRepo } from "@/data/chatRepository";
import { titleForFirstUserMessage, useChatStore } from "@/store/chat";
import type { ChatSession, PersistedChatMessage } from "@/types/chat";

const initialChatState = useChatStore.getInitialState();

const session: ChatSession = {
  id: "session-1",
  title: "New session",
  archived: false,
  agentId: null,
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
};

function persistedMessage(content: string): PersistedChatMessage {
  return {
    id: "message-1",
    sessionId: session.id,
    role: "user",
    status: "complete",
    content,
    parts: [],
    attachments: [],
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
  };
}

afterEach(() => {
  useChatStore.setState(initialChatState, true);
  vi.restoreAllMocks();
});

describe("titleForFirstUserMessage", () => {
  it("uses a non-empty pre-expansion hint for the first message title", () => {
    expect(
      titleForFirstUserMessage(
        "Analyze this request in a detailed framework: What should we do?",
        "  What should we do?  "
      )
    ).toBe("What should we do?");
  });

  it("falls back to the visible persisted message when no hint exists", () => {
    expect(
      titleForFirstUserMessage(
        "Analyze this request in a detailed framework: What should we do?"
      )
    ).toBe("Analyze this request in a de…");
  });

  it("keeps titleHint out of persistence while using it for the first title", async () => {
    const visibleContent = "Review this question:\nHow should we proceed?";
    const createMessage = vi
      .spyOn(chatRepo, "createMessage")
      .mockImplementation(async (input) => persistedMessage(input.content));
    const updateSession = vi
      .spyOn(chatRepo, "updateSession")
      .mockResolvedValue(undefined);
    vi.spyOn(chatRepo, "listSessions").mockResolvedValue([session]);
    useChatStore.setState({
      activeSessionId: session.id,
      sessions: [session],
      messages: [],
    });

    const message = await useChatStore.getState().addMessage({
      role: "user",
      content: visibleContent,
      titleHint: "How should we proceed?",
    });

    expect(message.content).toBe(visibleContent);
    expect(createMessage.mock.calls[0]?.[0]).toMatchObject({
      sessionId: session.id,
      role: "user",
      content: visibleContent,
    });
    expect(createMessage.mock.calls[0]?.[0]).not.toHaveProperty("titleHint");
    expect(updateSession).toHaveBeenCalledWith(session.id, {
      title: "How should we proceed?",
    });
  });
});
