import Database from "@tauri-apps/plugin-sql";
import type {
  ChatAttachment,
  ChatSession,
  ChatSessionSettings,
  MessagePart,
  PersistedChatMessage,
  SandboxRunRecord,
  SessionBundle,
  ToolCallRecord,
} from "@/types/chat";
import { DEFAULT_CHAT_SETTINGS } from "@/types/chat";
import { isTauri, uid } from "@/lib/utils";

const DB_URL = "sqlite:llmtoolforge.db";
const FALLBACK_KEY = "llmtoolforge.chat.sqlite-fallback";

type SqlDatabase = Awaited<ReturnType<typeof Database.load>>;

interface FallbackState {
  sessions: ChatSession[];
  settings: ChatSessionSettings[];
  messages: PersistedChatMessage[];
  parts: MessagePart[];
  attachments: ChatAttachment[];
  toolCalls: ToolCallRecord[];
  sandboxRuns: SandboxRunRecord[];
}

const emptyFallback = (): FallbackState => ({
  sessions: [],
  settings: [],
  messages: [],
  parts: [],
  attachments: [],
  toolCalls: [],
  sandboxRuns: [],
});

function nowIso(): string {
  return new Date().toISOString();
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function stringify(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}

function defaultSettings(sessionId: string): ChatSessionSettings {
  return {
    ...DEFAULT_CHAT_SETTINGS,
    sessionId,
    updatedAt: nowIso(),
  };
}

async function sha256(text: string): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) return undefined;
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function makeAttachment(
  sessionId: string,
  file: File,
  dataUrl: string
): Promise<ChatAttachment> {
  const createdAt = nowIso();
  const mime = file.type || "application/octet-stream";
  const kind = mime.startsWith("image/")
    ? "image"
    : mime.startsWith("audio/")
      ? "audio"
      : mime.startsWith("video/")
        ? "video"
        : "file";
  return {
    id: uid("att"),
    sessionId,
    kind,
    name: file.name || "attachment",
    mime,
    size: file.size,
    dataUrl,
    hash: await sha256(dataUrl),
    createdAt,
  };
}

function readFallback(): FallbackState {
  if (typeof localStorage === "undefined") return emptyFallback();
  return parseJson(localStorage.getItem(FALLBACK_KEY), emptyFallback());
}

function writeFallback(state: FallbackState) {
  localStorage.setItem(FALLBACK_KEY, JSON.stringify(state));
}

const migrations = [
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS session_settings (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    conn_key TEXT,
    model_id TEXT NOT NULL DEFAULT '',
    key_idx TEXT NOT NULL DEFAULT '0',
    wire_format TEXT NOT NULL DEFAULT 'openai-chat',
    system TEXT NOT NULL DEFAULT '',
    temperature TEXT NOT NULL DEFAULT '0.7',
    max_tokens TEXT NOT NULL DEFAULT '1024',
    streaming INTEGER NOT NULL DEFAULT 1,
    enabled_skill_ids TEXT NOT NULL DEFAULT '[]',
    enabled_mcp_server_ids TEXT NOT NULL DEFAULT '[]',
    sandbox_mode TEXT NOT NULL DEFAULT 'read-only',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    status TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    conn_key TEXT,
    provider TEXT,
    model_id TEXT,
    params_json TEXT,
    usage_json TEXT,
    raw_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS message_parts (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    text TEXT,
    url TEXT,
    attachment_id TEXT,
    mime TEXT,
    name TEXT,
    sort_order INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    data_url TEXT,
    path TEXT,
    hash TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
    source TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    title TEXT NOT NULL,
    arguments_json TEXT NOT NULL DEFAULT '{}',
    result_text TEXT,
    result_json TEXT,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    duration_ms INTEGER,
    error TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sandbox_runs (
    id TEXT PRIMARY KEY,
    tool_call_id TEXT REFERENCES tool_calls(id) ON DELETE SET NULL,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    command TEXT NOT NULL,
    args_json TEXT NOT NULL DEFAULT '[]',
    cwd TEXT,
    env_keys_json TEXT NOT NULL DEFAULT '[]',
    sandbox_mode TEXT NOT NULL,
    stdout TEXT NOT NULL DEFAULT '',
    stderr TEXT NOT NULL DEFAULT '',
    exit_code INTEGER,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    duration_ms INTEGER,
    error TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_parts_message_order ON message_parts(message_id, sort_order)`,
  `CREATE INDEX IF NOT EXISTS idx_tool_calls_session_started ON tool_calls(session_id, started_at)`,
];

class ChatRepository {
  private dbPromise: Promise<SqlDatabase> | null = null;
  private initialized = false;

  async init(): Promise<void> {
    if (!isTauri()) {
      if (typeof localStorage !== "undefined" && !localStorage.getItem(FALLBACK_KEY)) {
        writeFallback(emptyFallback());
      }
      this.initialized = true;
      return;
    }
    const db = await this.db();
    for (const sql of migrations) {
      await db.execute(sql);
    }
    this.initialized = true;
  }

  private async db(): Promise<SqlDatabase> {
    if (!this.dbPromise) this.dbPromise = Database.load(DB_URL);
    return this.dbPromise;
  }

  private async ensureInit() {
    if (!this.initialized) await this.init();
  }

  async fileToAttachment(sessionId: string, file: File): Promise<ChatAttachment> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error("读取附件失败"));
      reader.readAsDataURL(file);
    });
    return makeAttachment(sessionId, file, dataUrl);
  }

  async listSessions(): Promise<ChatSession[]> {
    await this.ensureInit();
    if (!isTauri()) {
      return [...readFallback().sessions].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt)
      );
    }
    const rows = await (await this.db()).select<Record<string, unknown>[]>(
      "SELECT id, title, archived, created_at, updated_at FROM sessions WHERE archived = 0 ORDER BY updated_at DESC"
    );
    return rows.map(rowToSession);
  }

  async createSession(title = "新会话"): Promise<SessionBundle> {
    await this.ensureInit();
    const timestamp = nowIso();
    const session: ChatSession = {
      id: uid("chat"),
      title,
      archived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const settings = defaultSettings(session.id);
    if (!isTauri()) {
      const state = readFallback();
      state.sessions.unshift(session);
      state.settings.unshift(settings);
      writeFallback(state);
      return { session, settings, messages: [], toolCalls: [], sandboxRuns: [] };
    }
    const db = await this.db();
    await db.execute(
      "INSERT INTO sessions (id, title, archived, created_at, updated_at) VALUES ($1, $2, 0, $3, $4)",
      [session.id, session.title, session.createdAt, session.updatedAt]
    );
    await this.upsertSettings(settings);
    return { session, settings, messages: [], toolCalls: [], sandboxRuns: [] };
  }

  async getSessionBundle(sessionId: string): Promise<SessionBundle | null> {
    await this.ensureInit();
    if (!isTauri()) {
      const state = readFallback();
      const session = state.sessions.find((s) => s.id === sessionId);
      if (!session) return null;
      const messages = state.messages
        .filter((m) => m.sessionId === sessionId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((m) => ({
          ...m,
          parts: state.parts
            .filter((p) => p.messageId === m.id)
            .sort((a, b) => a.sortOrder - b.sortOrder),
          attachments: state.attachments.filter((a) => a.messageId === m.id),
        }));
      return {
        session,
        settings:
          state.settings.find((s) => s.sessionId === sessionId) ??
          defaultSettings(sessionId),
        messages,
        toolCalls: state.toolCalls.filter((t) => t.sessionId === sessionId),
        sandboxRuns: state.sandboxRuns.filter((r) => r.sessionId === sessionId),
      };
    }

    const db = await this.db();
    const sessions = await db.select<Record<string, unknown>[]>(
      "SELECT id, title, archived, created_at, updated_at FROM sessions WHERE id = $1",
      [sessionId]
    );
    if (sessions.length === 0) return null;
    const settingsRows = await db.select<Record<string, unknown>[]>(
      "SELECT * FROM session_settings WHERE session_id = $1",
      [sessionId]
    );
    const messageRows = await db.select<Record<string, unknown>[]>(
      "SELECT * FROM messages WHERE session_id = $1 ORDER BY created_at ASC",
      [sessionId]
    );
    const ids = messageRows.map((r) => String(r.id));
    const partsRows =
      ids.length === 0
        ? []
        : await db.select<Record<string, unknown>[]>(
            `SELECT * FROM message_parts WHERE message_id IN (${ids
              .map((_, i) => `$${i + 1}`)
              .join(",")}) ORDER BY sort_order ASC`,
            ids
          );
    const attachmentRows = await db.select<Record<string, unknown>[]>(
      "SELECT * FROM attachments WHERE session_id = $1 ORDER BY created_at ASC",
      [sessionId]
    );
    const toolRows = await db.select<Record<string, unknown>[]>(
      "SELECT * FROM tool_calls WHERE session_id = $1 ORDER BY started_at DESC",
      [sessionId]
    );
    const sandboxRows = await db.select<Record<string, unknown>[]>(
      "SELECT * FROM sandbox_runs WHERE session_id = $1 ORDER BY started_at DESC",
      [sessionId]
    );
    const parts = partsRows.map(rowToPart);
    const attachments = attachmentRows.map(rowToAttachment);
    return {
      session: rowToSession(sessions[0]),
      settings: settingsRows[0]
        ? rowToSettings(settingsRows[0])
        : defaultSettings(sessionId),
      messages: messageRows.map((r) =>
        rowToMessage(
          r,
          parts.filter((p) => p.messageId === r.id),
          attachments.filter((a) => a.messageId === r.id)
        )
      ),
      toolCalls: toolRows.map(rowToToolCall),
      sandboxRuns: sandboxRows.map(rowToSandboxRun),
    };
  }

  async updateSession(id: string, patch: Partial<Pick<ChatSession, "title">>) {
    await this.ensureInit();
    const updatedAt = nowIso();
    if (!isTauri()) {
      const state = readFallback();
      state.sessions = state.sessions.map((s) =>
        s.id === id ? { ...s, ...patch, updatedAt } : s
      );
      writeFallback(state);
      return;
    }
    await (
      await this.db()
    ).execute("UPDATE sessions SET title = COALESCE($1, title), updated_at = $2 WHERE id = $3", [
      patch.title ?? null,
      updatedAt,
      id,
    ]);
  }

  async touchSession(id: string) {
    await this.updateSession(id, {});
  }

  async deleteSession(id: string) {
    await this.ensureInit();
    if (!isTauri()) {
      const state = readFallback();
      state.sessions = state.sessions.filter((s) => s.id !== id);
      state.settings = state.settings.filter((s) => s.sessionId !== id);
      state.messages = state.messages.filter((m) => m.sessionId !== id);
      const messageIds = new Set(state.messages.map((m) => m.id));
      state.parts = state.parts.filter((p) => messageIds.has(p.messageId));
      state.attachments = state.attachments.filter((a) => a.sessionId !== id);
      state.toolCalls = state.toolCalls.filter((t) => t.sessionId !== id);
      state.sandboxRuns = state.sandboxRuns.filter((r) => r.sessionId !== id);
      writeFallback(state);
      return;
    }
    const db = await this.db();
    await db.execute("DELETE FROM sandbox_runs WHERE session_id = $1", [id]);
    await db.execute("DELETE FROM tool_calls WHERE session_id = $1", [id]);
    await db.execute("DELETE FROM attachments WHERE session_id = $1", [id]);
    await db.execute(
      "DELETE FROM message_parts WHERE message_id IN (SELECT id FROM messages WHERE session_id = $1)",
      [id]
    );
    await db.execute("DELETE FROM messages WHERE session_id = $1", [id]);
    await db.execute("DELETE FROM session_settings WHERE session_id = $1", [id]);
    await db.execute("DELETE FROM sessions WHERE id = $1", [id]);
  }

  async updateSettings(
    sessionId: string,
    patch: Partial<Omit<ChatSessionSettings, "sessionId" | "updatedAt">>
  ): Promise<ChatSessionSettings> {
    const current =
      (await this.getSessionBundle(sessionId))?.settings ?? defaultSettings(sessionId);
    const next: ChatSessionSettings = {
      ...current,
      ...patch,
      updatedAt: nowIso(),
    };
    await this.upsertSettings(next);
    return next;
  }

  private async upsertSettings(settings: ChatSessionSettings) {
    await this.ensureInit();
    if (!isTauri()) {
      const state = readFallback();
      state.settings = [
        settings,
        ...state.settings.filter((s) => s.sessionId !== settings.sessionId),
      ];
      writeFallback(state);
      return;
    }
    await (
      await this.db()
    ).execute(
      `INSERT INTO session_settings (
        session_id, conn_key, model_id, key_idx, wire_format, system,
        temperature, max_tokens, streaming, enabled_skill_ids,
        enabled_mcp_server_ids, sandbox_mode, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT(session_id) DO UPDATE SET
        conn_key = excluded.conn_key,
        model_id = excluded.model_id,
        key_idx = excluded.key_idx,
        wire_format = excluded.wire_format,
        system = excluded.system,
        temperature = excluded.temperature,
        max_tokens = excluded.max_tokens,
        streaming = excluded.streaming,
        enabled_skill_ids = excluded.enabled_skill_ids,
        enabled_mcp_server_ids = excluded.enabled_mcp_server_ids,
        sandbox_mode = excluded.sandbox_mode,
        updated_at = excluded.updated_at`,
      [
        settings.sessionId,
        settings.connKey,
        settings.modelId,
        settings.keyIdx,
        settings.wireFormat,
        settings.system,
        settings.temperature,
        settings.maxTokens,
        settings.streaming ? 1 : 0,
        JSON.stringify(settings.enabledSkillIds),
        JSON.stringify(settings.enabledMcpServerIds),
        settings.sandboxMode,
        settings.updatedAt,
      ]
    );
  }

  async createMessage(input: {
    sessionId: string;
    role: PersistedChatMessage["role"];
    content: string;
    status?: PersistedChatMessage["status"];
    parts?: Omit<MessagePart, "messageId">[];
    attachments?: ChatAttachment[];
    connKey?: string;
    provider?: string;
    modelId?: string;
    paramsJson?: string;
  }): Promise<PersistedChatMessage> {
    await this.ensureInit();
    const timestamp = nowIso();
    const message: PersistedChatMessage = {
      id: uid("msg"),
      sessionId: input.sessionId,
      role: input.role,
      status: input.status ?? "complete",
      content: input.content,
      parts: (input.parts ?? []).map((p, i) => ({
        ...p,
        messageId: "",
        sortOrder: p.sortOrder ?? i,
      })),
      attachments: input.attachments ?? [],
      connKey: input.connKey,
      provider: input.provider,
      modelId: input.modelId,
      paramsJson: input.paramsJson,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    message.parts = message.parts.map((p) => ({ ...p, messageId: message.id }));
    message.attachments = message.attachments.map((a) => ({
      ...a,
      messageId: message.id,
    }));
    if (!isTauri()) {
      const state = readFallback();
      state.messages.push(message);
      state.parts.push(...message.parts);
      state.attachments.push(...message.attachments);
      writeFallback(state);
      await this.touchSession(input.sessionId);
      return message;
    }
    const db = await this.db();
    await db.execute(
      `INSERT INTO messages (
        id, session_id, role, status, content, conn_key, provider, model_id,
        params_json, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        message.id,
        message.sessionId,
        message.role,
        message.status,
        message.content,
        message.connKey ?? null,
        message.provider ?? null,
        message.modelId ?? null,
        message.paramsJson ?? null,
        message.createdAt,
        message.updatedAt,
      ]
    );
    for (const part of message.parts) await this.insertPart(part);
    for (const attachment of message.attachments) await this.insertAttachment(attachment);
    await this.touchSession(input.sessionId);
    return message;
  }

  async updateMessage(
    id: string,
    patch: Partial<
      Pick<
        PersistedChatMessage,
        "content" | "status" | "usage" | "raw" | "error" | "connKey" | "provider" | "modelId" | "paramsJson"
      >
    >
  ): Promise<void> {
    await this.ensureInit();
    const updatedAt = nowIso();
    if (!isTauri()) {
      const state = readFallback();
      state.messages = state.messages.map((m) =>
        m.id === id ? { ...m, ...patch, updatedAt } : m
      );
      writeFallback(state);
      return;
    }
    await (
      await this.db()
    ).execute(
      `UPDATE messages SET
        content = COALESCE($1, content),
        status = COALESCE($2, status),
        usage_json = $3,
        raw_json = $4,
        error = $5,
        conn_key = COALESCE($6, conn_key),
        provider = COALESCE($7, provider),
        model_id = COALESCE($8, model_id),
        params_json = COALESCE($9, params_json),
        updated_at = $10
      WHERE id = $11`,
      [
        patch.content ?? null,
        patch.status ?? null,
        stringify(patch.usage),
        stringify(patch.raw),
        patch.error ?? null,
        patch.connKey ?? null,
        patch.provider ?? null,
        patch.modelId ?? null,
        patch.paramsJson ?? null,
        updatedAt,
        id,
      ]
    );
  }

  async deleteMessagesFrom(
    sessionId: string,
    messageId: string,
    includeTarget: boolean
  ): Promise<void> {
    await this.ensureInit();
    if (!isTauri()) {
      const state = readFallback();
      const ordered = state.messages
        .filter((m) => m.sessionId === sessionId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const index = ordered.findIndex((m) => m.id === messageId);
      if (index === -1) return;
      const targetIds = new Set(
        ordered.slice(includeTarget ? index : index + 1).map((m) => m.id)
      );
      if (targetIds.size === 0) return;
      const targetToolIds = new Set(
        state.toolCalls
          .filter((call) => call.messageId && targetIds.has(call.messageId))
          .map((call) => call.id)
      );
      state.messages = state.messages.filter((m) => !targetIds.has(m.id));
      state.parts = state.parts.filter((p) => !targetIds.has(p.messageId));
      state.attachments = state.attachments.filter(
        (a) => !a.messageId || !targetIds.has(a.messageId)
      );
      state.toolCalls = state.toolCalls.filter(
        (call) => !call.messageId || !targetIds.has(call.messageId)
      );
      state.sandboxRuns = state.sandboxRuns.filter(
        (run) => !run.toolCallId || !targetToolIds.has(run.toolCallId)
      );
      writeFallback(state);
      await this.touchSession(sessionId);
      return;
    }

    const db = await this.db();
    const rows = await db.select<Record<string, unknown>[]>(
      "SELECT id FROM messages WHERE session_id = $1 ORDER BY created_at ASC",
      [sessionId]
    );
    const ids = rows.map((row) => String(row.id));
    const index = ids.indexOf(messageId);
    if (index === -1) return;
    const targetIds = ids.slice(includeTarget ? index : index + 1);
    if (targetIds.length === 0) return;
    const placeholders = targetIds.map((_, i) => `$${i + 2}`).join(",");
    const toolRows = await db.select<Record<string, unknown>[]>(
      `SELECT id FROM tool_calls WHERE session_id = $1 AND message_id IN (${placeholders})`,
      [sessionId, ...targetIds]
    );
    const toolIds = toolRows.map((row) => String(row.id));
    if (toolIds.length > 0) {
      const toolPlaceholders = toolIds.map((_, i) => `$${i + 2}`).join(",");
      await db.execute(
        `DELETE FROM sandbox_runs WHERE session_id = $1 AND tool_call_id IN (${toolPlaceholders})`,
        [sessionId, ...toolIds]
      );
    }
    await db.execute(
      `DELETE FROM tool_calls WHERE session_id = $1 AND message_id IN (${placeholders})`,
      [sessionId, ...targetIds]
    );
    await db.execute(
      `DELETE FROM attachments WHERE session_id = $1 AND message_id IN (${placeholders})`,
      [sessionId, ...targetIds]
    );
    await db.execute(
      `DELETE FROM message_parts WHERE message_id IN (${targetIds
        .map((_, i) => `$${i + 1}`)
        .join(",")})`,
      targetIds
    );
    await db.execute(
      `DELETE FROM messages WHERE session_id = $1 AND id IN (${placeholders})`,
      [sessionId, ...targetIds]
    );
    await this.touchSession(sessionId);
  }

  async replaceMessageContent(
    messageId: string,
    content: string,
    parts?: Omit<MessagePart, "messageId">[]
  ): Promise<PersistedChatMessage> {
    await this.ensureInit();
    const updatedAt = nowIso();
    if (!isTauri()) {
      const state = readFallback();
      const message = state.messages.find((m) => m.id === messageId);
      if (!message) throw new Error("消息不存在");
      const nextParts = (
        parts ?? [{ id: uid("part"), kind: "text" as const, text: content, sortOrder: 0 }]
      ).map((part, index) => ({
        ...part,
        messageId,
        sortOrder: part.sortOrder ?? index,
      }));
      state.messages = state.messages.map((m) =>
        m.id === messageId ? { ...m, content, updatedAt } : m
      );
      state.parts = [
        ...state.parts.filter((part) => part.messageId !== messageId),
        ...nextParts,
      ];
      writeFallback(state);
      await this.touchSession(message.sessionId);
      return {
        ...message,
        content,
        parts: nextParts,
        attachments: state.attachments.filter((a) => a.messageId === messageId),
        updatedAt,
      };
    }

    const db = await this.db();
    const rows = await db.select<Record<string, unknown>[]>(
      "SELECT session_id FROM messages WHERE id = $1",
      [messageId]
    );
    const sessionId = rows[0]?.session_id ? String(rows[0].session_id) : null;
    if (!sessionId) throw new Error("消息不存在");
    const nextParts = (
      parts ?? [{ id: uid("part"), kind: "text" as const, text: content, sortOrder: 0 }]
    ).map((part, index) => ({
      ...part,
      messageId,
      sortOrder: part.sortOrder ?? index,
    }));
    await db.execute(
      "UPDATE messages SET content = $1, updated_at = $2 WHERE id = $3",
      [content, updatedAt, messageId]
    );
    await db.execute("DELETE FROM message_parts WHERE message_id = $1", [messageId]);
    for (const part of nextParts) await this.insertPart(part);
    await this.touchSession(sessionId);
    const bundle = await this.getSessionBundle(sessionId);
    const message = bundle?.messages.find((m) => m.id === messageId);
    if (!message) throw new Error("消息不存在");
    return message;
  }

  async appendMessageArtifacts(
    messageId: string,
    input: {
      parts?: Omit<MessagePart, "messageId">[];
      attachments?: ChatAttachment[];
    }
  ): Promise<{ parts: MessagePart[]; attachments: ChatAttachment[] }> {
    await this.ensureInit();
    if (!input.parts?.length && !input.attachments?.length) {
      return { parts: [], attachments: [] };
    }
    const updatedAt = nowIso();
    if (!isTauri()) {
      const state = readFallback();
      const message = state.messages.find((m) => m.id === messageId);
      if (!message) throw new Error("消息不存在");
      const parts = (input.parts ?? []).map((part, index) => ({
        ...part,
        messageId,
        sortOrder: part.sortOrder ?? index,
      }));
      const attachments = (input.attachments ?? []).map((attachment) => ({
        ...attachment,
        sessionId: message.sessionId,
        messageId,
      }));
      state.parts.push(...parts);
      state.attachments.push(...attachments);
      state.messages = state.messages.map((m) =>
        m.id === messageId ? { ...m, updatedAt } : m
      );
      writeFallback(state);
      await this.touchSession(message.sessionId);
      return { parts, attachments };
    }

    const db = await this.db();
    const rows = await db.select<Record<string, unknown>[]>(
      "SELECT session_id FROM messages WHERE id = $1",
      [messageId]
    );
    const sessionId = rows[0]?.session_id ? String(rows[0].session_id) : null;
    if (!sessionId) throw new Error("消息不存在");
    const parts = (input.parts ?? []).map((part, index) => ({
      ...part,
      messageId,
      sortOrder: part.sortOrder ?? index,
    }));
    const attachments = (input.attachments ?? []).map((attachment) => ({
      ...attachment,
      sessionId,
      messageId,
    }));
    for (const part of parts) await this.insertPart(part);
    for (const attachment of attachments) await this.insertAttachment(attachment);
    await db.execute("UPDATE messages SET updated_at = $1 WHERE id = $2", [
      updatedAt,
      messageId,
    ]);
    await this.touchSession(sessionId);
    return { parts, attachments };
  }

  async recordToolCall(record: Omit<ToolCallRecord, "id"> & { id?: string }) {
    await this.ensureInit();
    const toolCall: ToolCallRecord = { ...record, id: record.id ?? uid("tool") };
    if (!isTauri()) {
      const state = readFallback();
      state.toolCalls.unshift(toolCall);
      writeFallback(state);
      return toolCall;
    }
    await (
      await this.db()
    ).execute(
      `INSERT INTO tool_calls (
        id, session_id, message_id, source, tool_name, title, arguments_json,
        result_text, result_json, status, started_at, completed_at, duration_ms, error
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        toolCall.id,
        toolCall.sessionId,
        toolCall.messageId ?? null,
        toolCall.source,
        toolCall.toolName,
        toolCall.title,
        toolCall.argumentsJson,
        toolCall.resultText ?? null,
        stringify(toolCall.resultJson),
        toolCall.status,
        toolCall.startedAt,
        toolCall.completedAt ?? null,
        toolCall.durationMs ?? null,
        toolCall.error ?? null,
      ]
    );
    return toolCall;
  }

  async recordSandboxRun(record: Omit<SandboxRunRecord, "id"> & { id?: string }) {
    await this.ensureInit();
    const run: SandboxRunRecord = { ...record, id: record.id ?? uid("run") };
    if (!isTauri()) {
      const state = readFallback();
      state.sandboxRuns.unshift(run);
      writeFallback(state);
      return run;
    }
    await (
      await this.db()
    ).execute(
      `INSERT INTO sandbox_runs (
        id, tool_call_id, session_id, command, args_json, cwd, env_keys_json,
        sandbox_mode, stdout, stderr, exit_code, status, started_at,
        completed_at, duration_ms, error
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        run.id,
        run.toolCallId ?? null,
        run.sessionId,
        run.command,
        JSON.stringify(run.args),
        run.cwd ?? null,
        JSON.stringify(run.envKeys),
        run.sandboxMode,
        run.stdout,
        run.stderr,
        run.exitCode ?? null,
        run.status,
        run.startedAt,
        run.completedAt ?? null,
        run.durationMs ?? null,
        run.error ?? null,
      ]
    );
    return run;
  }

  private async insertPart(part: MessagePart) {
    await (
      await this.db()
    ).execute(
      `INSERT INTO message_parts (
        id, message_id, kind, text, url, attachment_id, mime, name, sort_order
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        part.id,
        part.messageId,
        part.kind,
        part.text ?? null,
        part.url ?? null,
        part.attachmentId ?? null,
        part.mime ?? null,
        part.name ?? null,
        part.sortOrder,
      ]
    );
  }

  private async insertAttachment(attachment: ChatAttachment) {
    await (
      await this.db()
    ).execute(
      `INSERT INTO attachments (
        id, session_id, message_id, kind, name, mime, size, data_url, path, hash, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        attachment.id,
        attachment.sessionId,
        attachment.messageId ?? null,
        attachment.kind,
        attachment.name,
        attachment.mime,
        attachment.size,
        attachment.dataUrl ?? null,
        attachment.path ?? null,
        attachment.hash ?? null,
        attachment.createdAt,
      ]
    );
  }
}

function rowToSession(row: Record<string, unknown>): ChatSession {
  return {
    id: String(row.id),
    title: String(row.title),
    archived: Number(row.archived) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToSettings(row: Record<string, unknown>): ChatSessionSettings {
  return {
    sessionId: String(row.session_id),
    connKey: row.conn_key ? String(row.conn_key) : null,
    modelId: String(row.model_id ?? ""),
    keyIdx: String(row.key_idx ?? "0"),
    wireFormat: (row.wire_format as ChatSessionSettings["wireFormat"]) ?? "openai-chat",
    system: String(row.system ?? ""),
    temperature: String(row.temperature ?? "0.7"),
    maxTokens: String(row.max_tokens ?? "1024"),
    streaming: Number(row.streaming ?? 1) === 1,
    enabledSkillIds: parseJson(String(row.enabled_skill_ids ?? "[]"), []),
    enabledMcpServerIds: parseJson(String(row.enabled_mcp_server_ids ?? "[]"), []),
    sandboxMode:
      (row.sandbox_mode as ChatSessionSettings["sandboxMode"]) ?? "read-only",
    updatedAt: String(row.updated_at),
  };
}

function rowToPart(row: Record<string, unknown>): MessagePart {
  return {
    id: String(row.id),
    messageId: String(row.message_id),
    kind: row.kind as MessagePart["kind"],
    text: row.text ? String(row.text) : undefined,
    url: row.url ? String(row.url) : undefined,
    attachmentId: row.attachment_id ? String(row.attachment_id) : undefined,
    mime: row.mime ? String(row.mime) : undefined,
    name: row.name ? String(row.name) : undefined,
    sortOrder: Number(row.sort_order ?? 0),
  };
}

function rowToAttachment(row: Record<string, unknown>): ChatAttachment {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    messageId: row.message_id ? String(row.message_id) : undefined,
    kind: row.kind as ChatAttachment["kind"],
    name: String(row.name),
    mime: String(row.mime),
    size: Number(row.size ?? 0),
    dataUrl: row.data_url ? String(row.data_url) : undefined,
    path: row.path ? String(row.path) : undefined,
    hash: row.hash ? String(row.hash) : undefined,
    createdAt: String(row.created_at),
  };
}

function rowToMessage(
  row: Record<string, unknown>,
  parts: MessagePart[],
  attachments: ChatAttachment[]
): PersistedChatMessage {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    role: row.role as PersistedChatMessage["role"],
    status: row.status as PersistedChatMessage["status"],
    content: String(row.content ?? ""),
    parts,
    attachments,
    connKey: row.conn_key ? String(row.conn_key) : undefined,
    provider: row.provider ? String(row.provider) : undefined,
    modelId: row.model_id ? String(row.model_id) : undefined,
    paramsJson: row.params_json ? String(row.params_json) : undefined,
    usage: parseJson(String(row.usage_json ?? ""), undefined),
    raw: parseJson(String(row.raw_json ?? ""), undefined),
    error: row.error ? String(row.error) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToToolCall(row: Record<string, unknown>): ToolCallRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    messageId: row.message_id ? String(row.message_id) : undefined,
    source: row.source as ToolCallRecord["source"],
    toolName: String(row.tool_name),
    title: String(row.title),
    argumentsJson: String(row.arguments_json ?? "{}"),
    resultText: row.result_text ? String(row.result_text) : undefined,
    resultJson: parseJson(String(row.result_json ?? ""), undefined),
    status: row.status as ToolCallRecord["status"],
    startedAt: String(row.started_at),
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    durationMs: row.duration_ms == null ? undefined : Number(row.duration_ms),
    error: row.error ? String(row.error) : undefined,
  };
}

function rowToSandboxRun(row: Record<string, unknown>): SandboxRunRecord {
  return {
    id: String(row.id),
    toolCallId: row.tool_call_id ? String(row.tool_call_id) : undefined,
    sessionId: String(row.session_id),
    command: String(row.command),
    args: parseJson(String(row.args_json ?? "[]"), []),
    cwd: row.cwd ? String(row.cwd) : undefined,
    envKeys: parseJson(String(row.env_keys_json ?? "[]"), []),
    sandboxMode: row.sandbox_mode as SandboxRunRecord["sandboxMode"],
    stdout: String(row.stdout ?? ""),
    stderr: String(row.stderr ?? ""),
    exitCode: row.exit_code == null ? undefined : Number(row.exit_code),
    status: row.status as SandboxRunRecord["status"],
    startedAt: String(row.started_at),
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    durationMs: row.duration_ms == null ? undefined : Number(row.duration_ms),
    error: row.error ? String(row.error) : undefined,
  };
}

export const chatRepo = new ChatRepository();
