/**
 * AAP — Agent Adapter Protocol.
 *
 * A minimal, framework-neutral wire protocol between the LLMToolForge host
 * (Tauri/Rust supervisor) and an external agent subprocess (Python / Node).
 *
 * Transport: newline-delimited JSON over the subprocess's stdio.
 *  - Host → Agent: plain JSON object per line written to the child's stdin.
 *  - Agent → Host: each event line is prefixed with {@link AAP_MARKER} on stdout,
 *    e.g. `@@AAP@@{"type":"assistant_delta","delta":"hi"}`. Any stdout line
 *    without the marker is treated as diagnostic logging (forwarded to stderr).
 *
 * The event set is a 1:1 mirror of the in-app `AgentRuntimeCallbacks` so the
 * existing chat UI can render an external agent without any special-casing:
 * the external runtime accumulates deltas and invokes the same callbacks.
 */

/** Bump when the wire shape changes incompatibly. */
export const AAP_PROTOCOL_VERSION = 1;

/** Stdout line prefix marking a structured agent → host event. */
export const AAP_MARKER = "@@AAP@@";

// ---------------------------------------------------------------------------
// Host → Agent (written to child stdin, one JSON object per line)
// ---------------------------------------------------------------------------

export interface AapInitConfig {
  /** Unified gateway base URL, e.g. `http://127.0.0.1:4141/v1`. */
  baseUrl: string;
  /** Local API key the gateway expects (Bearer). */
  localKey: string;
  /** Exposed Unified model id, `{connName}/{model}`. */
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
}

export interface AapHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * A host-provided tool the external agent may invoke back into the app
 * (Phase 2 reverse bridge). These mirror the built-in agent tools — bash, file
 * I/O, grep, web_fetch, MCP tools, skills — and run through the same sandbox and
 * human-approval gating. `parameters` is a JSON Schema object describing the
 * tool's arguments so the agent's framework can register it as an LLM tool.
 */
export interface AapHostToolSpec {
  name: string;
  description: string;
  /** JSON Schema (object) for the tool arguments. */
  parameters: unknown;
}

/** First message after spawn: hands the agent its model/gateway config. */
export interface AapInitMessage {
  type: "init";
  protocolVersion: number;
  config: AapInitConfig;
  /** Prior conversation, oldest-first, excluding the in-flight user turn. */
  history: AapHistoryMessage[];
  /**
   * Host tools the agent may call via {@link AapHostToolCallEvent}. Omitted or
   * empty when the host exposes none (Phase 1 behaviour).
   */
  hostTools?: AapHostToolSpec[];
}

/** A user turn. `input` is the prompt text (attachment paths inlined by host). */
export interface AapPromptMessage {
  type: "prompt";
  input: string;
}

/** Cooperative cancel request for the current turn. */
export interface AapAbortMessage {
  type: "abort";
}

/**
 * Host → Agent reply to an {@link AapHostToolCallEvent}. Correlated by `callId`.
 * `resultText` is the human/LLM-readable result; `resultJson` carries structured
 * details when available. `isError` marks a failed/denied invocation.
 */
export interface AapHostToolResultMessage {
  type: "host_tool_result";
  callId: string;
  toolName: string;
  resultText: string;
  resultJson?: unknown;
  isError: boolean;
}

export type AapHostMessage =
  | AapInitMessage
  | AapPromptMessage
  | AapAbortMessage
  | AapHostToolResultMessage;

// ---------------------------------------------------------------------------
// Agent → Host (emitted on stdout, marker-prefixed, one JSON object per line)
// ---------------------------------------------------------------------------

/** Handshake: agent is up and understood `init`. Optional but recommended. */
export interface AapReadyEvent {
  type: "ready";
  protocolVersion?: number;
  /** Free-form agent identity for diagnostics (framework, version, …). */
  agent?: string;
}

/** A new assistant turn began (new message bubble). */
export interface AapAssistantStartEvent {
  type: "assistant_start";
}

/** Incremental assistant text. The host accumulates before rendering. */
export interface AapAssistantDeltaEvent {
  type: "assistant_delta";
  delta: string;
}

/** Incremental chain-of-thought text. The host accumulates. */
export interface AapReasoningDeltaEvent {
  type: "reasoning_delta";
  delta: string;
}

/** Assistant turn finished. `text` is the final, full assistant text. */
export interface AapAssistantEndEvent {
  type: "assistant_end";
  text: string;
}

/** A tool call started. */
export interface AapToolStartEvent {
  type: "tool_start";
  toolCallId: string;
  toolName: string;
  args?: unknown;
}

/** A tool call finished. */
export interface AapToolEndEvent {
  type: "tool_end";
  toolCallId: string;
  toolName: string;
  resultText: string;
  resultJson?: unknown;
  isError: boolean;
}

/** A fatal turn error. Also ends the run's current turn. */
export interface AapErrorEvent {
  type: "error";
  message: string;
}

/**
 * Agent → Host request to invoke a host tool (Phase 2 reverse bridge). The host
 * executes the named tool (through the same sandbox + approval path as built-in
 * agents) and replies with an {@link AapHostToolResultMessage} carrying the same
 * `callId`. The agent blocks its framework tool call until the reply arrives.
 */
export interface AapHostToolCallEvent {
  type: "host_tool_call";
  /** Correlation id chosen by the agent; echoed back in the result. */
  callId: string;
  toolName: string;
  args?: unknown;
}

/** The current run/turn reached idle. */
export interface AapDoneEvent {
  type: "done";
}

export type AapAgentEvent =
  | AapReadyEvent
  | AapAssistantStartEvent
  | AapAssistantDeltaEvent
  | AapReasoningDeltaEvent
  | AapAssistantEndEvent
  | AapToolStartEvent
  | AapToolEndEvent
  | AapHostToolCallEvent
  | AapErrorEvent
  | AapDoneEvent;

export type AapAgentEventType = AapAgentEvent["type"];

// ---------------------------------------------------------------------------
// (De)serialization helpers
// ---------------------------------------------------------------------------

/** Serialize a host → agent message into a single stdin line (no trailing NL). */
export function encodeHostMessage(msg: AapHostMessage): string {
  return JSON.stringify(msg);
}

/**
 * Parse one raw stdout line into an AAP agent event.
 *
 * Returns `null` for non-marker (diagnostic) lines or malformed payloads so the
 * caller can forward them as plain logs instead of crashing the stream.
 */
export function parseAgentLine(line: string): AapAgentEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(AAP_MARKER)) return null;
  const json = trimmed.slice(AAP_MARKER.length).trim();
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { type?: unknown };
    if (!parsed || typeof parsed.type !== "string") return null;
    return parsed as AapAgentEvent;
  } catch {
    return null;
  }
}

/** Narrow an already-parsed payload object into an AAP agent event. */
export function asAgentEvent(payload: unknown): AapAgentEvent | null {
  if (
    payload &&
    typeof payload === "object" &&
    typeof (payload as { type?: unknown }).type === "string"
  ) {
    return payload as AapAgentEvent;
  }
  return null;
}
