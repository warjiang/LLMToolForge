/**
 * Volcengine Ark inference (chat) adapter.
 *
 * Talks to the runtime API at ark.cn-beijing.volces.com/api/v3 with a Bearer
 * Ark API Key. Supports the OpenAI-compatible /chat/completions endpoint and the
 * OpenAI Responses-compatible /responses endpoint, with SSE streaming.
 */

import { httpFetch } from "@/lib/http";
import type {
  ChatMessage,
  ChatRequest,
  ChatResult,
  ChatStreamChunk,
  ContentPart,
  ProviderCredential,
  WireFormat,
} from "@/lib/providers/types";

const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

function baseUrl(cred: ProviderCredential): string {
  return (cred.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function requireKey(cred: ProviderCredential): string {
  if (!cred.apiKey) throw new Error("缺少 Ark API Key");
  return cred.apiKey;
}

// ---- message conversion ----

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
  if (stream) body.stream_options = { include_usage: true };
  return body;
}

/** Build the Responses API "input" array, preserving multimodal parts. */
function buildResponsesBody(req: ChatRequest, stream: boolean) {
  const input = req.messages.map((m) => {
    const isAssistant = m.role === "assistant";
    const textType = isAssistant ? "output_text" : "input_text";
    const content =
      typeof m.content === "string"
        ? [{ type: textType, text: m.content }]
        : m.content.map((p) =>
            p.type === "text"
              ? { type: textType, text: p.text }
              : { type: "input_image", image_url: p.url }
          );
    return { role: m.role, content };
  });
  const body: Record<string, unknown> = {
    model: req.model,
    input,
    stream,
  };
  if (req.params?.temperature != null)
    body.temperature = req.params.temperature;
  if (req.params?.maxTokens != null)
    body.max_output_tokens = req.params.maxTokens;
  return body;
}

function endpointFor(format: WireFormat): string {
  return format === "openai-responses" ? "/responses" : "/chat/completions";
}

async function postJson(
  cred: ProviderCredential,
  path: string,
  body: unknown,
  signal?: AbortSignal
): Promise<Response> {
  return httpFetch(`${baseUrl(cred)}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireKey(cred)}`,
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

// ---- non-streaming ----

export async function chat(
  req: ChatRequest,
  cred: ProviderCredential
): Promise<ChatResult> {
  const format = req.wireFormat ?? "openai-chat";
  if (format === "openai-responses") {
    const res = await postJson(
      cred,
      "/responses",
      buildResponsesBody(req, false),
      req.signal
    );
    await ensureOk(res, "Responses");
    const json = await res.json();
    return { content: extractResponsesText(json), raw: json };
  }

  const res = await postJson(
    cred,
    endpointFor(format),
    buildChatBody(req, false),
    req.signal
  );
  await ensureOk(res, "Chat");
  const json = await res.json();
  const choice = json?.choices?.[0]?.message?.content ?? "";
  return {
    content: typeof choice === "string" ? choice : "",
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

function extractResponsesText(json: unknown): string {
  const j = json as {
    output_text?: string;
    output?: { content?: { type?: string; text?: string }[] }[];
  };
  if (typeof j.output_text === "string") return j.output_text;
  const parts = j.output?.flatMap((o) => o.content ?? []) ?? [];
  return parts
    .filter((p) => p.type === "output_text" || p.text)
    .map((p) => p.text ?? "")
    .join("");
}

// ---- streaming ----

export async function* chatStream(
  req: ChatRequest,
  cred: ProviderCredential
): AsyncGenerator<ChatStreamChunk, void, unknown> {
  const format = req.wireFormat ?? "openai-chat";
  const isResponses = format === "openai-responses";
  const res = await postJson(
    cred,
    endpointFor(format),
    isResponses ? buildResponsesBody(req, true) : buildChatBody(req, true),
    req.signal
  );
  await ensureOk(res, "Chat(stream)");
  if (!res.body) {
    throw new Error("流式响应缺少 body");
  }

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
      const chunk = isResponses
        ? parseResponsesChunk(parsed)
        : parseChatChunk(parsed);
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

function parseResponsesChunk(parsed: unknown): ChatStreamChunk | null {
  const p = parsed as { type?: string; delta?: string };
  if (p.type === "response.output_text.delta" && p.delta) {
    return { delta: p.delta, done: false };
  }
  return null;
}
