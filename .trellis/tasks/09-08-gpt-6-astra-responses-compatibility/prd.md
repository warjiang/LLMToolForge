# GPT-6 Astra tool calling protocol compatibility

## Goal

Allow `gpt-6-astra` to complete tool-enabled turns through the existing built-in
Pi runtime, including ordinary chat with tools, DataAgent, and ResearchAgent,
without the reported Chat-Completions compatibility `400`. Preserve historical
model behavior and do not add a user-facing API-protocol selector.

## Confirmed Facts

- A tool-enabled `gpt-6-astra` request currently fails with:

  ```text
  Function tools with reasoning_effort are not supported for this model in
  /v1/chat/completions. To use function tools, use /v1/responses or set
  reasoning_effort to 'none'.
  ```

- The same workflow succeeds with historical GPT-5 models, DeepSeek V4, and
  Kimi K3.
- The built-in Pi Agent runtime currently sends every exposed model through
  OpenAI Chat Completions.
- Ordinary chat with tools normally delegates to an ad-hoc Pi agent; it is not
  a separate provider-adapter tool loop.
- The underlying Direct Chat adapter uses the configured upstream base URL and
  model id. Its tool-enabled branch is non-streaming and records tool calls
  without executing a tool-result/continuation loop.
- The embedded Unified Gateway already exposes `/v1/responses`.
- Local request serialization proved that the current Pi model declaration
  (`reasoning: false`) does not explicitly add `reasoning_effort`; the error
  can represent model-default or proxy-applied reasoning.
- A successful Responses tool loop against the affected upstream has not yet
  been demonstrated. Returning a function call alone is insufficient evidence.

## Requirements

- Validate the complete streamed tool loop using the installed Pi SDK and the
  actual Unified Gateway before implementing production routing.
- For Pi runs, select Responses only for the exact upstream model id
  `gpt-6-astra` when resolved function tools are present. Keep the protocol
  fixed for that runtime, including tool-result continuations.
- Keep Chat Completions for all other Pi models and for requests without
  function tools. A plain-text user prompt is not necessarily a tool-free
  request: built-in tools may still be attached.
- Preserve upstream default reasoning without silently disabling it. Carry
  the reasoning state required for tool continuations within the Pi context.
- Report failed Responses requests and streams through structured gateway
  errors and the existing chat error lifecycle. Preserve diagnostic context;
  never reinterpret an ambiguous `404` as proof of endpoint non-support.
- Do not automatically retry or switch protocols after a failure in this
  release, including unknown-model compatibility errors.
- Distinguish Responses in Gateway Monitor and OpenAPI, capture its usage, and
  distinguish success, incomplete output, upstream failure, and cancellation.
- Preserve current tool definitions, tool execution, approvals, sandboxing,
  MCP wrappers, connector contracts, chat persistence, and Direct Chat adapter
  behavior. Reuse Pi rather than implementing another tool loop.

## Out of Scope

- A transparent gateway that converts arbitrary third-party
  Chat-Completions clients to Responses and translates all response/tool-loop
  semantics back to Chat Completions.
- A user-facing manual protocol switch.
- A blanket migration of all providers or all models to Responses.
- Sending discovery-time probe requests to every model.
- Automatic compatibility retry, capability learning, persistent capability
  caches, and associated repository/store/sync lifecycle changes.
- Adding Responses to the generic Direct Chat adapter, streaming tool-call
  fields to provider contracts, or tool execution to its recording-only path.
- Server-side conversation storage, `previous_response_id` integration, or
  new persisted reasoning/tool-state fields.
- Changing external AAP agents' SDKs or protocol choices.

## Acceptance Criteria

- [ ] The pre-implementation spike completes a streamed request, executes one
  side-effect-free tool exactly once, replays its result and required reasoning
  state, and receives a successful final answer through the real gateway.
- [ ] Ordinary chat with tools, DataAgent, and ResearchAgent all use the same
  Pi Responses path for `gpt-6-astra`; approval, rejection, and stop still work.
- [ ] A Pi request with no tools uses Chat Completions, including
  `gpt-6-astra`; GPT-5, DeepSeek V4, Kimi K3, and unknown models keep that
  protocol even when tools are attached.
- [ ] Unknown-model compatibility errors do not cause an automatic second
  request or write capability state.
- [ ] Outgoing Responses requests preserve default reasoning, use stateless
  item replay, and do not send an implicit reasoning-off override.
- [ ] HTTP rejection, in-stream failure, and missing terminal events surface as
  errors without executing partial tool calls or marking the turn successful.
- [ ] Gateway Monitor distinguishes `openai-responses`, records input/output/
  total usage, and does not log failed or truncated Responses streams as
  successful. OpenAPI documents the endpoint and error/stream semantics.
- [ ] Generic Direct Chat adapters and their normalized types remain unchanged.
- [ ] Targeted unit tests, all frontend tests/build checks, gateway tests, and
  sidecar compilation pass.

## Planning Gate

- The task remains `planning`. This revision does not authorize production
  implementation or claim that the real-upstream spike has passed.
- No additional product-scope decision is needed for this reduced plan.
  Implementation remains gated on approval and the technical spike in
  `implement.md`. If the upstream cannot support the stateless reasoning/tool
  loop, return to planning rather than silently expanding scope or disabling
  reasoning.
