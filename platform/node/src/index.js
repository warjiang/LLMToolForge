/**
 * @llmtoolforge/agent-sdk — build LLMToolForge external agents in Node.
 *
 * Minimal usage:
 *
 *   import { run, modelConfig } from "@llmtoolforge/agent-sdk";
 *
 *   run({
 *     name: "my-agent",
 *     async onPrompt(ctx) {
 *       ctx.assistantStart();
 *       ctx.assistantDelta("hello");
 *       ctx.assistantEnd("hello");
 *     },
 *   });
 */

export { run, TurnContext, AAP_MARKER, AAP_PROTOCOL_VERSION } from "./runtime.js";
export { modelConfig } from "./model.js";
