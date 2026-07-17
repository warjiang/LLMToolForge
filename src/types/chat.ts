import type { ChatRole, ChatUsage, WireFormat } from "@/lib/providers/types";

export type MessagePartKind =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "file"
  | "tool_result";
export type PersistedMessageRole = ChatRole | "tool";
export type MessageStatus = "pending" | "complete" | "error";
export type ToolCallSource = "internal" | "mcp" | "skill";
export type ToolRunStatus = "pending" | "running" | "success" | "error";
/** Transient (in-memory) lifecycle of a session's agent turn. */
export type SessionRunStatus = "running" | "done" | "error";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface ChatSession {
  id: string;
  title: string;
  archived: boolean;
  /** Committed agent id once the conversation has started; null = direct chat. */
  agentId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatSessionSettings {
  sessionId: string;
  connKey: string | null;
  modelId: string;
  keyIdx: string;
  wireFormat: WireFormat;
  system: string;
  temperature: string;
  maxTokens: string;
  streaming: boolean;
  enabledSkillIds: string[];
  enabledMcpServerIds: string[];
  /** Grant the agent OpenConnector discovery/execute tools. Default false. */
  connectorEnabled: boolean;
  sandboxMode: SandboxMode;
  autoApproveCheckpoints: boolean;
  /** Absolute execution root for local tools. Empty = managed temp sandbox. */
  workspacePath: string;
  updatedAt: string;
}

export interface MessagePart {
  id: string;
  messageId: string;
  kind: MessagePartKind;
  text?: string;
  url?: string;
  attachmentId?: string;
  mime?: string;
  name?: string;
  sortOrder: number;
}

export interface ChatAttachment {
  id: string;
  sessionId: string;
  messageId?: string;
  kind: "image" | "audio" | "video" | "file";
  name: string;
  mime: string;
  size: number;
  dataUrl?: string;
  path?: string;
  hash?: string;
  createdAt: string;
}

export interface PersistedChatMessage {
  id: string;
  sessionId: string;
  role: PersistedMessageRole;
  status: MessageStatus;
  content: string;
  reasoning?: string;
  reasoningMs?: number;
  parts: MessagePart[];
  attachments: ChatAttachment[];
  connKey?: string;
  provider?: string;
  modelId?: string;
  paramsJson?: string;
  usage?: ChatUsage;
  raw?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolCallRecord {
  id: string;
  sessionId: string;
  messageId?: string;
  source: ToolCallSource;
  toolName: string;
  title: string;
  argumentsJson: string;
  resultText?: string;
  resultJson?: unknown;
  status: ToolRunStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
}

export interface SandboxRunRecord {
  id: string;
  toolCallId?: string;
  sessionId: string;
  command: string;
  args: string[];
  cwd?: string;
  envKeys: string[];
  sandboxMode: SandboxMode;
  stdout: string;
  stderr: string;
  exitCode?: number;
  status: ToolRunStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
}

export interface SessionBundle {
  session: ChatSession;
  settings: ChatSessionSettings;
  messages: PersistedChatMessage[];
  toolCalls: ToolCallRecord[];
  sandboxRuns: SandboxRunRecord[];
}

export const DEFAULT_CHAT_SETTINGS: Omit<
  ChatSessionSettings,
  "sessionId" | "updatedAt"
> = {
  connKey: null,
  modelId: "",
  keyIdx: "0",
  wireFormat: "openai-chat",
  system: "",
  temperature: "0.7",
  maxTokens: "1024",
  streaming: true,
  enabledSkillIds: [],
  enabledMcpServerIds: [],
  connectorEnabled: false,
  sandboxMode: "workspace-write",
  autoApproveCheckpoints: false,
  workspacePath: "",
};
