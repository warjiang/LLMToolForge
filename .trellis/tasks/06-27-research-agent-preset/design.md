# Design: Research Agent Preset

## Architecture

- Add `ResearchAgent` as a built-in agent option in the existing Agent picker,
  alongside `DataAgent`, rather than adding a separate Direct/Research mode
  selector or new persisted chat setting.
- Keep `ResearchAgent` inside the existing Playground chat surface rather than
  adding a dedicated research page.
- Build `ResearchAgent` as an ad-hoc `AgentDefinition`, similar to `DataAgent`,
  so it uses the selected exposed Unified model and resolved session workspace
  at runtime.
- Place the research prompt in a small frontend module and append/compose it
  with the user's session system prompt only when `ResearchAgent` is selected.
- Keep the `research-harness` implementation root built into the prompt:
  `/Users/dingwenjiang/workspace/opensource/warjiang/research-harness`.
- Add a built-in `checkpoint` internal tool. It pauses the active Pi agent tool
  execution through a runtime callback, renders an approval card in the chat
  composer area, and resumes the same turn with `{ approved, note, decidedAt }`.
- Add `session_settings.auto_approve_checkpoints` and the matching fallback
  setting. It defaults to false; when true, checkpoint requests resolve
  immediately with `approved: true` and an auto-approval note while preserving
  the existing tool-call result path.
- Add a ResearchAgent-only `beforeToolCall` guard that synthesizes a checkpoint
  when a model directly calls protected tools instead of explicitly calling
  `checkpoint`.

## Data Flow

- Agent picker -> session `agentId` (`__research__`) -> existing
  `chat.setSessionAgent` persistence.
- Send action -> validate content/attachments and settings -> if
  `ResearchAgent`: require a chat-capable model, then build a research ad-hoc
  agent using all internal tools. Empty explicit workspace paths are resolved to
  the session default workspace by `resolveSessionWorkspace`.
- Runtime -> existing Pi agent tool pipeline -> Tauri `run_sandboxed_command`
  and `fs_*` commands -> session project root. Harness CLI commands `cd` into
  the built-in harness implementation root and pass the session root via
  `--root`.
- Protected research step -> `checkpoint` tool call -> `tool_calls.status =
  pending` and active approval state -> user approves/rejects -> tool result is
  persisted through the existing tool-call end path.
- Auto-approval enabled -> checkpoint request -> immediate
  `{ approved: true, note, decidedAt }` decision -> same tool-call end path, no
  approval card wait.
- Direct protected tool call -> Pi `beforeToolCall` -> synthesized checkpoint
  request using the same tool call id -> approval card -> approved continues the
  original tool; rejected blocks/aborts the original tool.

## Contracts

- Existing sessions require no settings migration for `ResearchAgent`; direct
  chat remains `agentId: null`.
- Empty `workspacePath` is valid for `ResearchAgent`; the resolved session
  workspace is used as the research project/data root.
- The agent prompt must not require the session workspace itself to contain
  `pyproject.toml` or `research_harness`; only the built-in harness root is
  checked for those markers.
- Planning-only requests, including new scenario keyword matrices and channel
  crawl plans, do not require checking the built-in harness root first.
- `ResearchAgent` never changes `sandboxMode`; warning text is advisory.
- Auto-approval never changes `sandboxMode`; protected commands still succeed or
  fail according to the current sandbox mode.
- Internal tool calls persist as `source: "internal"`; MCP remains `"mcp"` and
  skill/load-skill/internal non-MCP distinctions must not collapse into one
  source.
- The harness remains external. All operations go through shell/file tools.
- Checkpoint state is in-memory for the active desktop run. Existing `tool_calls`
  records preserve the request/result for audit, but app restart does not resume
  a suspended tool promise.
- The runtime guard is intentionally ResearchAgent-only. Direct chat, DataAgent,
  custom agents, safe read/list/search tools, and non-protected shell commands
  remain unchanged.

## Compatibility

- Reuse existing `sessions.agent_id` persistence; no `session_settings` column is
  required for `ResearchAgent`.
- Keep `AgentDefinition` unchanged; `ResearchAgent` can be synthesized in
  memory.
- Keep hidden custom-agent picker behavior unchanged unless directly required by
  `ResearchAgent`.
