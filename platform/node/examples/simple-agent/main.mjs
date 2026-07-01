#!/usr/bin/env node
/**
 * Vercel AI SDK example agent.
 *
 * Streams a model response (and any tool calls) through the internal Unified
 * gateway, mapping the Vercel AI SDK `fullStream` to AAP events via the SDK
 * adapter. The host injects UNIFIED_BASE_URL / UNIFIED_API_KEY / UNIFIED_MODEL
 * and also provides them in the `init` config.
 *
 * Install deps in an isolated env before running (done by the host at install):
 *   pnpm install
 */

import { run, modelConfig } from "@llmtoolforge/agent-sdk";
import { pipeVercelStream } from "@llmtoolforge/agent-sdk/adapters/vercel-ai";
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

run({
  name: "vercel-ai-agent",
  async onPrompt(ctx) {
    const { baseURL, apiKey, model } = modelConfig(ctx.config);
    const openai = createOpenAI({ baseURL, apiKey });

    const messages = [
      ...(ctx.history ?? []).map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: ctx.input },
    ];

    const result = streamText({
      model: openai(model),
      system: ctx.config?.systemPrompt || undefined,
      temperature: ctx.config?.temperature,
      maxTokens: ctx.config?.maxTokens,
      messages,
      abortSignal: ctx.signal,
    });

    await pipeVercelStream(ctx, result);
  },
});
