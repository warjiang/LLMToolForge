#!/usr/bin/env node
/**
 * Mock OpenAI-compatible gateway for phase1 end-to-end testing.
 *
 * Stands in for the internal Unified gateway so we can exercise the *real*
 * framework code paths (LangChain `ChatOpenAI`, Vercel AI `streamText`) without
 * cloud credentials. Implements just enough of the Chat Completions API:
 *   - GET  /v1/models
 *   - POST /v1/chat/completions   (streaming SSE + non-streaming)
 *
 * The reply deterministically echoes the last user message so the harness can
 * assert on the streamed content.
 *
 * Usage: node mock-gateway.mjs [port]   (default 4199)
 */

import http from "node:http";

const PORT = Number(process.argv[2] || 4199);

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") {
      return typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content.map((p) => p.text ?? "").join("")
          : String(m.content);
    }
  }
  return "";
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url.startsWith("/v1/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        object: "list",
        data: [{ id: "mock/model", object: "model", owned_by: "mock" }],
      })
    );
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/v1/chat/completions")) {
    const body = JSON.parse((await readBody(req)) || "{}");
    const reply = "reply: " + lastUserText(body.messages || []);
    const words = reply.match(/\S+\s*/g) || [reply];
    const id = "chatcmpl-mock";
    const model = body.model || "mock/model";

    if (body.stream) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      send({
        id,
        object: "chat.completion.chunk",
        model,
        choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
      });
      let i = 0;
      const timer = setInterval(() => {
        if (i < words.length) {
          send({
            id,
            object: "chat.completion.chunk",
            model,
            choices: [
              { index: 0, delta: { content: words[i] }, finish_reason: null },
            ],
          });
          i++;
        } else {
          send({
            id,
            object: "chat.completion.chunk",
            model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          });
          res.write("data: [DONE]\n\n");
          clearInterval(timer);
          res.end();
        }
      }, 10);
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id,
          object: "chat.completion",
          model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: reply },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: words.length, total_tokens: 1 },
        })
      );
    }
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-gateway] listening on http://127.0.0.1:${PORT}/v1`);
});
