/**
 * Chat client for OpenAI-compatible gateways (new-api / litellm).
 *
 * Talks to `{baseUrl}/chat/completions` with a Bearer API key, supporting the
 * OpenAI Chat format and SSE streaming. The base URL is expected to already
 * include the API version segment (e.g. `https://host/v1`).
 */

import type {
  ChatMessage,
  ChatRequest,
  ChatResult,
  ChatStreamChunk,
  ContentPart,
  ProviderCredential,
} from "@/lib/providers/types";
import {
  authHeader,
  endpoint,
  gatewayFetch,
  normalizeBaseUrl,
} from "./request";

function baseUrl(cred: ProviderCredential): string {
  return normalizeBaseUrl(cred);
}

function requireKey(cred: ProviderCredential): string {
  return authHeader(cred);
}

function toOpenAIContent(content: string | ContentPart[]) {
  if (typeof content === "string") return content;
  return content.map((p) =>
    p.type === "text"
      ? { type: "text", text: p.text }
      : { type: "image_url", image_url: { url: p.url } }
  );
}

function toOpenAIMessages(messages: ChatMessage[]) {
  return messages.map((m) => ({
    role: m.role,
    content: toOpenAIContent(m.content),
  }));
}

function buildChatBody(req: ChatRequest, stream: boolean) {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: toOpenAIMessages(req.messages),
    stream,
  };
  if (req.params?.temperature != null)
    body.temperature = req.params.temperature;
  if (req.params?.maxTokens != null) body.max_tokens = req.params.maxTokens;
  if (req.params?.topP != null) body.top_p = req.params.topP;
  if (req.tools?.length) body.tools = req.tools;
  if (req.toolChoice) body.tool_choice = req.toolChoice;
  if (stream) body.stream_options = { include_usage: true };
  return body;
}

async function postChat(
  cred: ProviderCredential,
  body: unknown,
  signal?: AbortSignal
): Promise<Response> {
  return gatewayFetch(endpoint(baseUrl(cred), "chat/completions"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: requireKey(cred),
    },
    body: JSON.stringify(body),
    signal,
  });
}

async function ensureOk(res: Response, label: string) {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${label} 失败: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
}

export async function chat(
  req: ChatRequest,
  cred: ProviderCredential
): Promise<ChatResult> {
  const res = await postChat(cred, buildChatBody(req, false), req.signal);
  await ensureOk(res, "Chat");
  const json = await res.json();
  const message = json?.choices?.[0]?.message;
  const choice = message?.content ?? "";
  return {
    content: typeof choice === "string" ? choice : "",
    toolCalls: Array.isArray(message?.tool_calls)
      ? message.tool_calls
      : undefined,
    usage: json?.usage
      ? {
          promptTokens: json.usage.prompt_tokens,
          completionTokens: json.usage.completion_tokens,
          totalTokens: json.usage.total_tokens,
        }
      : undefined,
    raw: json,
  };
}

export async function* chatStream(
  req: ChatRequest,
  cred: ProviderCredential
): AsyncGenerator<ChatStreamChunk, void, unknown> {
  const res = await postChat(cred, buildChatBody(req, true), req.signal);
  await ensureOk(res, "Chat(stream)");
  if (!res.body) throw new Error("流式响应缺少 body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const evt of events) {
      const dataLines = evt
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim());
      if (dataLines.length === 0) continue;
      const data = dataLines.join("");
      if (data === "[DONE]") {
        yield { delta: "", done: true };
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      const chunk = parseChatChunk(parsed);
      if (chunk) yield chunk;
    }
  }
  yield { delta: "", done: true };
}

function parseChatChunk(parsed: unknown): ChatStreamChunk | null {
  const p = parsed as {
    choices?: { delta?: { content?: string } }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  const delta = p.choices?.[0]?.delta?.content ?? "";
  const usage = p.usage
    ? {
        promptTokens: p.usage.prompt_tokens,
        completionTokens: p.usage.completion_tokens,
        totalTokens: p.usage.total_tokens,
      }
    : undefined;
  if (!delta && !usage) return null;
  return { delta, done: false, usage };
}
