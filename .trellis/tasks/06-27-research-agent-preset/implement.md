# Implement: Research Agent Preset

## Steps

1. Add a built-in `ResearchAgent` branch to the existing Agent picker/runtime
   path, reusing session `agentId` persistence like `DataAgent`.
2. Add a research prompt module that captures `research-harness` workflow,
   built-in harness root, session project root, approval, blocked collection,
   audit, publishing rules, DataAgent-style HTML deliverable tooling, and the
   rule that planning drafts do not require harness path detection first.
3. Add a `checkpoint` internal tool and runtime callback that pauses the current
   agent turn until the user approves or rejects the protected action.
4. Update `AgentChatView` to show Research sandbox warnings when
   `ResearchAgent` is selected, allow empty explicit workspace paths to reuse
   the session default workspace, synthesize a Research ad-hoc agent from
   current model/settings, render the active checkpoint approval card, and allow
   explicit per-session checkpoint auto-approval.
5. Add a ResearchAgent-only runtime guard that forces a synthesized checkpoint
   when a model directly calls protected shell/write/edit/artifact tools.
6. Update tool-call source classification to persist internal tool calls as
   `"internal"`.
7. Add optional tool-call `goal` parameters and render them on collapsed tool
   cards so ResearchAgent execution steps are self-describing.
8. Ensure ResearchAgent can use `data_chart_html` / `data_report_html` for
   evidence-backed browser-previewable pages without a separate reporting
   implementation.
9. Run `pnpm build` and fix type/build errors.

## Validation

- `pnpm build`
- Manual desktop smoke tests:
  - Direct mode unchanged.
  - `ResearchAgent` without an explicit workspace path uses the session default
    workspace as the research project/data root.
  - `ResearchAgent` can draft a new scenario keyword matrix/channel plan in an
    empty session workspace without asking for a harness repository path.
  - `ResearchAgent` requests a checkpoint before protected collection/import/
    normalize/audit/analyze/publish/commit steps; approval continues and
    rejection stops the protected step.
  - With checkpoint auto-approval enabled, `ResearchAgent` protected steps
    continue without waiting on the approval card and record an auto-approval
    note in the checkpoint result.
  - `ResearchAgent` can create a browser-previewable HTML research report using
    `data_report_html` after checkpoint approval.
  - ResearchAgent tool calls include concise `goal` arguments and the collapsed
    tool cards render those goals under the tool name.
  - A model that directly calls a protected ResearchAgent tool without visible
    reasoning still triggers the checkpoint card before execution.
  - `ResearchAgent` uses the built-in harness root at
    `/Users/dingwenjiang/workspace/opensource/warjiang/research-harness` and can
    execute a safe harness command against the session workspace.
  - Read-only blocks writes; workspace-write permits session-workspace research
    file writes.

## Rollback Points

- Revert `ResearchAgent` UI/runtime and prompt together if runtime behavior
  regresses.
