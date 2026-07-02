# AAP — Agent Adapter Protocol (v1)

Framework-neutral wire protocol between the LLMToolForge host (Tauri/Rust) and an
external agent subprocess (Python / Node). The TypeScript definitions in
`protocol.ts` are the source of truth; this document is the cross-language
contract the Python/Node SDKs implement.

## Transport

Newline-delimited JSON over the subprocess's standard streams.

- **Host → Agent**: one plain JSON object per line, written to the child's
  **stdin**.
- **Agent → Host**: one JSON object per line, written to **stdout**, prefixed
  with the marker `@@AAP@@`. Example:

  ```
  @@AAP@@{"type":"assistant_delta","delta":"Hello"}
  ```

  Any stdout line **without** the marker is treated as diagnostic logging and
  forwarded to the host's stderr. Agents should therefore feel free to
  `print()` freely for debugging — only marker lines are interpreted.

## Host → Agent messages

### `init` (always sent first, once)
```json
{
  "type": "init",
  "protocolVersion": 1,
  "config": {
    "baseUrl": "http://127.0.0.1:4141/v1",
    "localKey": "sk-local-…",
    "model": "volcengine/doubao-pro",
    "systemPrompt": "You are…",
    "temperature": 0.7,
    "maxTokens": 4096
  },
  "history": [
    { "role": "user", "content": "…" },
    { "role": "assistant", "content": "…" }
  ],
  "hostTools": [
    {
      "name": "bash",
      "description": "Run a shell command in the sandbox.",
      "parameters": { "type": "object", "properties": { "command": { "type": "string" } } }
    }
  ]
}
```
The agent must talk to the model **only** through `config.baseUrl` using
`config.localKey` as the Bearer token and `config.model` as the model name — this
is the internal Unified gateway (OpenAI-compatible; Anthropic bridge also
available at the same base).

### `prompt`
```json
{ "type": "prompt", "input": "user turn text" }
```

### `abort`
```json
{ "type": "abort" }
```
Cooperative cancel of the in-flight turn. The agent should stop as soon as
practical and emit `done` (or `error`).

`hostTools` in `init` (optional; Phase 2) advertises app tools the agent may
call back into the host via `host_tool_call`. Each entry's `parameters` is a
JSON Schema object. Host tools run under the host's sandbox + human-approval.

### `host_tool_result` (Phase 2)
```json
{
  "type": "host_tool_result",
  "callId": "n1",
  "toolName": "bash",
  "resultText": "…",
  "resultJson": { "exitCode": 0 },
  "isError": false
}
```
The host's reply to a `host_tool_call`, correlated by `callId`. The agent
unblocks the framework tool call that requested it.

## Agent → Host events (marker-prefixed)

| type              | fields                                                         | maps to callback      |
| ----------------- | -------------------------------------------------------------- | --------------------- |
| `ready`           | `protocolVersion?`, `agent?`                                   | (handshake)           |
| `assistant_start` | —                                                              | `onAssistantStart`    |
| `assistant_delta` | `delta`                                                        | `onAssistantDelta`\*  |
| `reasoning_delta` | `delta`                                                        | `onReasoningDelta`\*  |
| `assistant_end`   | `text` (full final text)                                       | `onAssistantEnd`      |
| `tool_start`      | `toolCallId`, `toolName`, `args?`                              | `onToolStart`         |
| `tool_end`        | `toolCallId`, `toolName`, `resultText`, `resultJson?`, `isError` | `onToolEnd`         |
| `host_tool_call`  | `callId`, `toolName`, `args?`                                  | executes a host tool  |
| `error`           | `message`                                                      | `onError`             |
| `done`            | —                                                              | `onDone`              |

\* The host **accumulates** successive `delta`s and passes the running total to
the UI callback (matching the built-in runtime's contract). Agents send
incremental deltas.

## Turn lifecycle

```
host → init
host → prompt
agent → ready            (optional, once)
agent → assistant_start
agent → reasoning_delta* (0+)
agent → assistant_delta* (0+)
agent → tool_start / tool_end   (0+ interleaved)   [framework-native tools]
agent → host_tool_call → host → host_tool_result   (0+ interleaved)   [Phase 2]
agent → assistant_end
agent → done
```

- Multiple assistant segments per turn are allowed (repeat
  `assistant_start … assistant_end`). Emit exactly one `done` to end the turn.
- On failure emit `error` then `done`.

## Phase 2 — host-tool reverse bridge

External agents reuse the app's built-in tools (bash / fs / grep / web_fetch /
MCP / Skills) without reimplementing them:

- Host advertises available tools in `init.hostTools` (name + description +
  JSON-Schema parameters).
- Agent → Host: `{ "type": "host_tool_call", "callId", "toolName", "args" }`.
- Host executes the tool through the **same** sandbox + human-approval path as
  the built-in agent, surfaces it in the chat UI as a normal tool call, then
  replies Host → Agent: `{ "type": "host_tool_result", "callId", "toolName",
  "resultText", "resultJson?", "isError" }`.
- The Node SDK exposes `ctx.callHostTool(name, args)` + `ctx.hostTools`, and
  `hostToolsForVercel(ctx)` to register them as Vercel AI SDK tools. The Python
  SDK exposes `ctx.call_host_tool(name, args)` + `ctx.host_tools`, and
  `host_tools_for_langchain(ctx)` to register them as LangChain tools.
