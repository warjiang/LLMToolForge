# Research Agent Preset

## Goal

Add an in-app `ResearchAgent` preset to LLMToolForge so a user can point a chat
session at a local `research-harness` repository and have the current chat model
operate the harness through the existing agent tools.

## Requirements

- Provide `ResearchAgent` as a built-in selectable agent alongside `DataAgent`,
  not as a separate Direct/Research chat mode selector.
- `ResearchAgent` uses the current chat model, resolved session workspace,
  current sandbox mode, all internal tools, and explicitly enabled skills/MCP
  servers.
- The `research-harness` implementation is a built-in capability rooted at
  `/Users/dingwenjiang/workspace/opensource/warjiang/research-harness`.
- The resolved session workspace is treated as the research project/data root. If
  no explicit workspace path is set, `ResearchAgent` reuses the session's default
  workspace.
- `ResearchAgent` must not automatically elevate sandbox permissions. If sandbox
  mode is not `workspace-write`, show a visible warning while still letting the
  user decide whether to switch.
- Add a research-specific system prompt that requires the agent to verify the
  built-in harness implementation root, run the harness against the session
  workspace with `python3 -m research_harness --root "$PROJECT_ROOT"` or exact
  Makefile targets,
  draft keyword matrices before collection, stop for explicit approval before
  collection/import/normalization/audit/analysis/publishing, stop on diagnosis
  or blocked collector states, require clean audit-backed evidence before
  conclusions, and review generated sensitive artifacts before commit/publish.
- Add an internal `checkpoint` tool that pauses the current in-app agent turn for
  human approval. `ResearchAgent` must use it before collection, import,
  normalize, audit, analyze, publish, or commit steps. Approval is session-local
  for this version; app restart recovery is out of scope.
- Add an optional per-session auto-approval setting for checkpoints. It defaults
  off, is visible for `ResearchAgent`, records an auto-approval note in the tool
  result, and does not change sandbox permissions.
- Add a ResearchAgent runtime guard so models that skip visible reasoning or do
  not voluntarily call `checkpoint` are still paused before protected shell,
  write/edit, or generated-artifact tool calls.
- Add a user-visible tool-call `goal` convention so ResearchAgent execution
  timelines explain the intent of each tool step while preserving existing tool
  call arguments and results.
- Allow `ResearchAgent` to use the existing DataAgent-style HTML deliverable
  tools (`data_chart_html` and `data_report_html`) for evidence-backed browser
  preview pages after checkpoint approval. Do not create a separate TypeScript
  reporting pipeline.
- Drafting a keyword matrix or channel crawl plan must not require path setup or
  harness repository detection; repository verification is only required before
  CLI/file operations.
- Distinguish internal tool calls from skill and MCP calls in persisted tool-call
  records.
- Do not port or rewrite the Python `research-harness` pipeline in TypeScript.

## Acceptance Criteria

- [ ] `pnpm build` succeeds.
- [ ] Existing chat sessions load successfully with no new required settings.
- [ ] Direct mode keeps current behavior.
- [ ] `ResearchAgent` with an empty explicit workspace path uses the session
      default workspace as the research project/data root.
- [ ] `ResearchAgent` verifies the built-in harness root and can run a safe
      command against the session workspace, such as
      `PROJECT_ROOT="$PWD"; cd /Users/dingwenjiang/workspace/opensource/warjiang/research-harness && python3 -m research_harness --root "$PROJECT_ROOT" audit todo-extraction`.
- [ ] `ResearchAgent` can draft a new scenario keyword matrix and channel plan
      even when the session workspace is empty.
- [ ] `ResearchAgent` displays an approval checkpoint before protected harness
      actions, continues after approval, and stops that action after rejection.
- [ ] `ResearchAgent` can auto-approve checkpoints when the user explicitly
      enables the per-session auto-approval switch.
- [ ] `ResearchAgent` also displays an approval checkpoint when a model directly
      calls a protected tool without first calling the `checkpoint` tool.
- [ ] `ResearchAgent` can generate an evidence-backed HTML report or chart with
      `data_report_html` / `data_chart_html`, opening it through the existing
      browser preview artifact flow.
- [ ] ResearchAgent tool cards show a concise generated goal when the tool call
      arguments include `goal`.
- [ ] Read-only mode does not silently allow writes; workspace-write mode allows
      session-workspace research file writes.

## Notes

- User chose an in-app built-in Agent preset over a separate wizard, chat mode
  selector, or porting the harness.
- User chose built-in harness implementation plus per-session project root /
  default workspace reuse.
- User chose explicit sandbox switching rather than automatic elevation.
