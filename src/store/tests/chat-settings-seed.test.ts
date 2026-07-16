import { findSettingsSeedSessionId } from "@/store/chat";
import type { ChatSession } from "@/types/chat";

function session(id: string, agentId: string | null, updatedAt: string): ChatSession {
  return {
    id,
    title: id,
    archived: false,
    agentId,
    createdAt: updatedAt,
    updatedAt,
  };
}

export function runChatSettingsSeedTests() {
  const sessions = [
    session("direct-newer", null, "2026-07-16T10:10:00.000Z"),
    session("agent-old", "agent-a", "2026-07-16T10:00:00.000Z"),
    session("agent-new", "agent-a", "2026-07-16T10:20:00.000Z"),
    session("other-agent", "agent-b", "2026-07-16T10:30:00.000Z"),
  ];

  console.assert(
    findSettingsSeedSessionId(sessions, "agent-a") === "agent-new",
    "new agent sessions should seed from the newest session with the same agent"
  );
  console.assert(
    findSettingsSeedSessionId(sessions, null) === "direct-newer",
    "direct sessions should seed from the newest direct session"
  );
  console.assert(
    findSettingsSeedSessionId(sessions, "missing-agent") === null,
    "new agent partitions without history should not seed settings"
  );
}

runChatSettingsSeedTests();
