/**
 * Vercel AI SDK adapter.
 *
 * Bridges a Vercel AI SDK `streamText(...)` result to AAP events on a
 * {@link TurnContext}. Import-safe: it does NOT import the `ai` package itself,
 * so the SDK stays dependency-light — the agent package brings its own `ai` /
 * `@ai-sdk/openai` and passes the stream result in.
 *
 * Typical usage inside an agent's `onPrompt`:
 *
 *   import { streamText } from "ai";
 *   import { createOpenAI } from "@ai-sdk/openai";
 *   import { modelConfig } from "@llmtoolforge/agent-sdk";
 *   import { pipeVercelStream } from "@llmtoolforge/agent-sdk/adapters/vercel-ai";
 *
 *   async onPrompt(ctx) {
 *     const { baseURL, apiKey, model } = modelConfig(ctx.config);
 *     const openai = createOpenAI({ baseURL, apiKey });
 *     const result = streamText({
 *       model: openai(model),
 *       system: ctx.config?.systemPrompt,
 *       messages: [...ctx.history, { role: "user", content: ctx.input }],
 *       abortSignal: ctx.signal,
 *     });
 *     await pipeVercelStream(ctx, result);
 *   }
 *
 * Compatible with Vercel AI SDK v3/v4 `fullStream` part shapes.
 */

/**
 * Consume a `streamText` result's `fullStream` and emit AAP events.
 * @param {import("../runtime.js").TurnContext} ctx
 * @param {{ fullStream: AsyncIterable<any>, text?: Promise<string> }} result
 */
export async function pipeVercelStream(ctx, result) {
  ctx.assistantStart();
  let accumulated = "";

  for await (const part of result.fullStream) {
    if (ctx.aborted) break;
    switch (part.type) {
      case "text-delta": {
        const delta = part.textDelta ?? part.text ?? "";
        accumulated += delta;
        ctx.assistantDelta(delta);
        break;
      }
      case "reasoning":
      case "reasoning-delta": {
        ctx.reasoningDelta(part.textDelta ?? part.reasoning ?? part.text ?? "");
        break;
      }
      case "tool-call": {
        ctx.toolStart({
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          args: part.args ?? part.input,
        });
        break;
      }
      case "tool-result": {
        const output = part.result ?? part.output;
        ctx.toolEnd({
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          resultText:
            typeof output === "string" ? output : JSON.stringify(output),
          resultJson: output,
          isError: false,
        });
        break;
      }
      case "error": {
        throw part.error ?? new Error("vercel stream error");
      }
      default:
        break;
    }
  }

  // When aborted, the stream is torn down; awaiting `result.text` may never
  // settle. Fall back to what we accumulated so the turn can end cleanly.
  if (ctx.aborted) {
    ctx.assistantEnd(accumulated);
    return;
  }

  let finalText = accumulated;
  if (result.text) {
    try {
      finalText = await result.text;
    } catch {
      finalText = accumulated;
    }
  }
  ctx.assistantEnd(finalText ?? accumulated);
}
