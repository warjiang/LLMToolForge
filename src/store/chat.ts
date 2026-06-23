import { create } from "zustand";
import { chatRepo } from "@/data/chatRepository";
import type {
  ChatAttachment,
  ChatSession,
  ChatSessionSettings,
  MessagePart,
  PersistedChatMessage,
  SandboxRunRecord,
  ToolCallRecord,
} from "@/types/chat";
import { uid } from "@/lib/utils";

interface ChatState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  settings: ChatSessionSettings | null;
  messages: PersistedChatMessage[];
  toolCalls: ToolCallRecord[];
  sandboxRuns: SandboxRunRecord[];
  loading: boolean;
  error: string | null;
  init: () => Promise<void>;
  newSession: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  saveSettings: (
    patch: Partial<Omit<ChatSessionSettings, "sessionId" | "updatedAt">>
  ) => Promise<void>;
  fileToAttachment: (file: File) => Promise<ChatAttachment>;
  addMessage: (input: {
    role: PersistedChatMessage["role"];
    content: string;
    status?: PersistedChatMessage["status"];
    parts?: Omit<MessagePart, "messageId">[];
    attachments?: ChatAttachment[];
    connKey?: string;
    provider?: string;
    modelId?: string;
    paramsJson?: string;
  }) => Promise<PersistedChatMessage>;
  updateMessage: (
    id: string,
    patch: Parameters<typeof chatRepo.updateMessage>[1]
  ) => Promise<void>;
  appendMessageArtifacts: (
    id: string,
    input: Parameters<typeof chatRepo.appendMessageArtifacts>[1]
  ) => Promise<void>;
  recordToolCall: (
    input: Omit<ToolCallRecord, "id"> & { id?: string }
  ) => Promise<ToolCallRecord>;
  recordSandboxRun: (
    input: Omit<SandboxRunRecord, "id"> & { id?: string }
  ) => Promise<SandboxRunRecord>;
}

function titleFromFirstMessage(content: string): string {
  const title = content.trim().replace(/\s+/g, " ").slice(0, 28);
  return title || "新会话";
}

async function loadIntoState(set: (patch: Partial<ChatState>) => void, id: string) {
  const bundle = await chatRepo.getSessionBundle(id);
  if (!bundle) return;
  set({
    activeSessionId: id,
    settings: bundle.settings,
    messages: bundle.messages,
    toolCalls: bundle.toolCalls,
    sandboxRuns: bundle.sandboxRuns,
  });
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  settings: null,
  messages: [],
  toolCalls: [],
  sandboxRuns: [],
  loading: false,
  error: null,

  init: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      await chatRepo.init();
      let sessions = await chatRepo.listSessions();
      if (sessions.length === 0) {
        const created = await chatRepo.createSession();
        sessions = [created.session];
      }
      set({ sessions, loading: false });
      await loadIntoState(set, sessions[0].id);
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : "加载聊天数据失败",
      });
    }
  },

  newSession: async () => {
    const created = await chatRepo.createSession();
    set({ sessions: [created.session, ...get().sessions] });
    await loadIntoState(set, created.session.id);
  },

  selectSession: async (id) => {
    await loadIntoState(set, id);
  },

  renameSession: async (id, title) => {
    await chatRepo.updateSession(id, { title: title.trim() || "新会话" });
    set({
      sessions: get().sessions.map((s) =>
        s.id === id ? { ...s, title: title.trim() || "新会话" } : s
      ),
    });
  },

  deleteSession: async (id) => {
    await chatRepo.deleteSession(id);
    const sessions = await chatRepo.listSessions();
    set({ sessions });
    if (sessions.length === 0) {
      await get().newSession();
    } else if (get().activeSessionId === id) {
      await loadIntoState(set, sessions[0].id);
    }
  },

  saveSettings: async (patch) => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    const settings = await chatRepo.updateSettings(sessionId, patch);
    set({ settings });
  },

  fileToAttachment: async (file) => {
    let sessionId = get().activeSessionId;
    if (!sessionId) {
      await get().newSession();
      sessionId = get().activeSessionId;
    }
    if (!sessionId) throw new Error("没有可用会话");
    return chatRepo.fileToAttachment(sessionId, file);
  },

  addMessage: async (input) => {
    let sessionId = get().activeSessionId;
    if (!sessionId) {
      await get().newSession();
      sessionId = get().activeSessionId;
    }
    if (!sessionId) throw new Error("没有可用会话");
    const normalizedParts =
      input.parts ??
      (input.content
        ? [
            {
              id: uid("part"),
              kind: "text" as const,
              text: input.content,
              sortOrder: 0,
            },
          ]
        : []);
    const message = await chatRepo.createMessage({
      ...input,
      sessionId,
      parts: normalizedParts,
    });
    const messages = [...get().messages, message];
    set({ messages });
    const active = get().sessions.find((s) => s.id === sessionId);
    if (active?.title === "新会话" && input.role === "user") {
      const title = titleFromFirstMessage(input.content);
      await get().renameSession(sessionId, title);
    }
    set({ sessions: await chatRepo.listSessions() });
    return message;
  },

  updateMessage: async (id, patch) => {
    await chatRepo.updateMessage(id, patch);
    set({
      messages: get().messages.map((m) =>
        m.id === id ? { ...m, ...patch, updatedAt: new Date().toISOString() } : m
      ),
    });
  },

  appendMessageArtifacts: async (id, input) => {
    const artifacts = await chatRepo.appendMessageArtifacts(id, input);
    set({
      messages: get().messages.map((m) =>
        m.id === id
          ? {
              ...m,
              parts: [...m.parts, ...artifacts.parts].sort(
                (a, b) => a.sortOrder - b.sortOrder
              ),
              attachments: [...m.attachments, ...artifacts.attachments],
              updatedAt: new Date().toISOString(),
            }
          : m
      ),
    });
  },

  recordToolCall: async (input) => {
    const record = await chatRepo.recordToolCall(input);
    set({ toolCalls: [record, ...get().toolCalls] });
    return record;
  },

  recordSandboxRun: async (input) => {
    const record = await chatRepo.recordSandboxRun(input);
    set({ sandboxRuns: [record, ...get().sandboxRuns] });
    return record;
  },
}));
