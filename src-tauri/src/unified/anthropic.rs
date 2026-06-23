//! Anthropic-compatible `/v1/messages` endpoint.
//!
//! Translates the Anthropic Messages API to OpenAI Chat Completions for the
//! upstream, and translates the response (including SSE streaming and tool use)
//! back into Anthropic events so Claude Code can talk to any connected model.

use std::collections::VecDeque;
use std::pin::Pin;
use std::task::{Context, Poll};

use axum::body::{Body, Bytes};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use futures_util::Stream;
use serde_json::{json, Value};

use super::http::{
    check_auth, emit_log, json_error, lookup, post_chat, user_agent, AppCtx, Ctx, LogBuilder,
};

pub async fn messages(state: Ctx, headers: HeaderMap, body: axum::body::Bytes) -> Response {
    let ctx = state.0;
    if let Err(resp) = check_auth(&ctx, &headers).await {
        return resp;
    }

    let payload: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => {
            return json_error(
                StatusCode::BAD_REQUEST,
                &format!("请求体不是合法 JSON：{e}"),
            )
        }
    };

    let model = payload
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if model.is_empty() {
        return json_error(StatusCode::BAD_REQUEST, "缺少 model 字段");
    }

    let Some(upstream) = lookup(&ctx, &model).await else {
        return json_error(
            StatusCode::NOT_FOUND,
            &format!("未找到模型：{model}（请在应用内确认已暴露该模型）"),
        );
    };

    let stream = payload
        .get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let openai_body = to_openai_body(&payload, &upstream.real_model, stream);
    let log = LogBuilder::new(&model, &upstream, "anthropic", stream, user_agent(&headers));

    let resp = match post_chat(&ctx, &upstream, &openai_body).await {
        Ok(r) => r,
        Err(e) => {
            let rec = log.finish(502, None, Some(e.to_string()));
            emit_log(&ctx, rec).await;
            return json_error(StatusCode::BAD_GATEWAY, &format!("上游请求失败：{e}"));
        }
    };

    if stream && resp.status().is_success() {
        let status = resp.status().as_u16();
        let translator = Translator::new(model.clone());
        let body_stream = AnthropicStream::new(
            ctx.clone(),
            Box::pin(resp.bytes_stream()),
            translator,
            log,
            status,
        );
        return Response::builder()
            .status(status)
            .header("Content-Type", "text/event-stream")
            .header("Cache-Control", "no-cache")
            .header("Connection", "keep-alive")
            .body(Body::from_stream(body_stream))
            .unwrap_or_else(|_| json_error(StatusCode::INTERNAL_SERVER_ERROR, "无法构建流式响应"));
    }

    // Non-streaming: read OpenAI json and translate to an Anthropic message.
    let status = resp.status();
    let bytes = match resp.bytes().await {
        Ok(b) => b,
        Err(e) => {
            let rec = log.finish(status.as_u16(), None, Some(e.to_string()));
            emit_log(&ctx, rec).await;
            return json_error(StatusCode::BAD_GATEWAY, &format!("读取上游响应失败：{e}"));
        }
    };

    if !status.is_success() {
        let rec = log.finish(
            status.as_u16(),
            None,
            Some(format!("HTTP {}", status.as_u16())),
        );
        emit_log(&ctx, rec).await;
        return Response::builder()
            .status(status)
            .header("Content-Type", "application/json")
            .body(Body::from(bytes))
            .unwrap_or_else(|_| json_error(StatusCode::INTERNAL_SERVER_ERROR, "无法构建响应"));
    }

    let openai: Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(e) => {
            let rec = log.finish(status.as_u16(), None, Some(e.to_string()));
            emit_log(&ctx, rec).await;
            return json_error(StatusCode::BAD_GATEWAY, &format!("上游响应解析失败：{e}"));
        }
    };

    let tokens = super::openai::usage_from_json(&openai);
    let rec = log.finish(status.as_u16(), tokens, None);
    emit_log(&ctx, rec).await;

    let anthropic = openai_to_anthropic_message(&openai, &model);
    axum::Json(anthropic).into_response()
}

// ---------------------------------------------------------------------------
// Request translation: Anthropic Messages -> OpenAI Chat Completions
// ---------------------------------------------------------------------------

fn to_openai_body(req: &Value, real_model: &str, stream: bool) -> Value {
    let mut messages: Vec<Value> = Vec::new();

    if let Some(system) = req.get("system") {
        let text = system_text(system);
        if !text.is_empty() {
            messages.push(json!({ "role": "system", "content": text }));
        }
    }

    if let Some(arr) = req.get("messages").and_then(|v| v.as_array()) {
        for m in arr {
            convert_message(m, &mut messages);
        }
    }

    let mut body = json!({
        "model": real_model,
        "messages": messages,
        "stream": stream,
    });

    if let Some(v) = req.get("max_tokens").and_then(|v| v.as_u64()) {
        body["max_tokens"] = json!(v);
    }
    if let Some(v) = req.get("temperature").and_then(|v| v.as_f64()) {
        body["temperature"] = json!(v);
    }
    if let Some(v) = req.get("top_p").and_then(|v| v.as_f64()) {
        body["top_p"] = json!(v);
    }
    if let Some(v) = req.get("stop_sequences") {
        body["stop"] = v.clone();
    }
    if stream {
        body["stream_options"] = json!({ "include_usage": true });
    }
    if let Some(tools) = req.get("tools").and_then(|v| v.as_array()) {
        let converted: Vec<Value> = tools
            .iter()
            .filter_map(|t| {
                let name = t.get("name")?.as_str()?;
                Some(json!({
                    "type": "function",
                    "function": {
                        "name": name,
                        "description": t.get("description").and_then(|d| d.as_str()).unwrap_or(""),
                        "parameters": t.get("input_schema").cloned().unwrap_or_else(|| json!({"type": "object"})),
                    }
                }))
            })
            .collect();
        if !converted.is_empty() {
            body["tools"] = json!(converted);
        }
    }
    if let Some(tc) = req.get("tool_choice") {
        if let Some(mapped) = map_tool_choice(tc) {
            body["tool_choice"] = mapped;
        }
    }

    body
}

fn system_text(system: &Value) -> String {
    match system {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn convert_message(m: &Value, out: &mut Vec<Value>) {
    let role = m.get("role").and_then(|v| v.as_str()).unwrap_or("user");
    let content = m.get("content");

    // Simple string content.
    if let Some(s) = content.and_then(|c| c.as_str()) {
        out.push(json!({ "role": role, "content": s }));
        return;
    }

    let Some(blocks) = content.and_then(|c| c.as_array()) else {
        out.push(json!({ "role": role, "content": "" }));
        return;
    };

    let mut parts: Vec<Value> = Vec::new();
    let mut tool_calls: Vec<Value> = Vec::new();
    let mut tool_results: Vec<Value> = Vec::new();

    for block in blocks {
        match block.get("type").and_then(|t| t.as_str()) {
            Some("text") => {
                if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                    parts.push(json!({ "type": "text", "text": t }));
                }
            }
            Some("image") => {
                if let Some(url) = image_url(block) {
                    parts.push(json!({ "type": "image_url", "image_url": { "url": url } }));
                }
            }
            Some("tool_use") => {
                let id = block.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let name = block.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let input = block.get("input").cloned().unwrap_or_else(|| json!({}));
                tool_calls.push(json!({
                    "id": id,
                    "type": "function",
                    "function": { "name": name, "arguments": input.to_string() }
                }));
            }
            Some("tool_result") => {
                let id = block
                    .get("tool_use_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let text = tool_result_text(block.get("content"));
                tool_results.push(json!({
                    "role": "tool",
                    "tool_call_id": id,
                    "content": text,
                }));
            }
            _ => {}
        }
    }

    // tool_result blocks become standalone tool messages (user turns in Anthropic).
    for tr in tool_results {
        out.push(tr);
    }

    if role == "assistant" {
        let mut msg = json!({ "role": "assistant" });
        if parts.len() == 1 && parts[0].get("type").and_then(|t| t.as_str()) == Some("text") {
            msg["content"] = parts[0]["text"].clone();
        } else if !parts.is_empty() {
            msg["content"] = json!(parts);
        } else {
            msg["content"] = Value::Null;
        }
        if !tool_calls.is_empty() {
            msg["tool_calls"] = json!(tool_calls);
        }
        // Skip empty assistant messages (e.g. a user turn that was only tool_result).
        if !msg["content"].is_null() || msg.get("tool_calls").is_some() {
            out.push(msg);
        }
    } else if !parts.is_empty() {
        let content =
            if parts.len() == 1 && parts[0].get("type").and_then(|t| t.as_str()) == Some("text") {
                parts[0]["text"].clone()
            } else {
                json!(parts)
            };
        out.push(json!({ "role": "user", "content": content }));
    }
}

fn image_url(block: &Value) -> Option<String> {
    let source = block.get("source")?;
    match source.get("type").and_then(|t| t.as_str()) {
        Some("base64") => {
            let media = source.get("media_type").and_then(|m| m.as_str())?;
            let data = source.get("data").and_then(|d| d.as_str())?;
            Some(format!("data:{media};base64,{data}"))
        }
        Some("url") => source.get("url").and_then(|u| u.as_str()).map(String::from),
        _ => None,
    }
}

fn tool_result_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(blocks)) => blocks
            .iter()
            .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join("\n"),
        Some(other) => other.to_string(),
        None => String::new(),
    }
}

fn map_tool_choice(tc: &Value) -> Option<Value> {
    match tc.get("type").and_then(|t| t.as_str()) {
        Some("auto") => Some(json!("auto")),
        Some("any") => Some(json!("required")),
        Some("tool") => {
            let name = tc.get("name").and_then(|n| n.as_str())?;
            Some(json!({ "type": "function", "function": { "name": name } }))
        }
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Response translation: OpenAI -> Anthropic (non-streaming)
// ---------------------------------------------------------------------------

fn openai_to_anthropic_message(openai: &Value, model: &str) -> Value {
    let message = openai
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|c| c.first())
        .and_then(|c| c.get("message"));
    let finish = openai
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|c| c.first())
        .and_then(|c| c.get("finish_reason"))
        .and_then(|f| f.as_str());

    let mut content: Vec<Value> = Vec::new();
    if let Some(text) = message
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
    {
        if !text.is_empty() {
            content.push(json!({ "type": "text", "text": text }));
        }
    }
    if let Some(calls) = message
        .and_then(|m| m.get("tool_calls"))
        .and_then(|c| c.as_array())
    {
        for call in calls {
            let id = call.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let func = call.get("function");
            let name = func
                .and_then(|f| f.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let args = func
                .and_then(|f| f.get("arguments"))
                .and_then(|v| v.as_str())
                .unwrap_or("{}");
            let input: Value = serde_json::from_str(args).unwrap_or_else(|_| json!({}));
            content.push(json!({ "type": "tool_use", "id": id, "name": name, "input": input }));
        }
    }

    let usage = openai.get("usage");
    let input_tokens = usage
        .and_then(|u| u.get("prompt_tokens"))
        .and_then(|x| x.as_u64())
        .unwrap_or(0);
    let output_tokens = usage
        .and_then(|u| u.get("completion_tokens"))
        .and_then(|x| x.as_u64())
        .unwrap_or(0);

    json!({
        "id": openai.get("id").and_then(|v| v.as_str()).unwrap_or(""),
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": content,
        "stop_reason": map_stop_reason(finish),
        "stop_sequence": Value::Null,
        "usage": { "input_tokens": input_tokens, "output_tokens": output_tokens }
    })
}

fn map_stop_reason(finish: Option<&str>) -> Value {
    match finish {
        Some("length") => json!("max_tokens"),
        Some("tool_calls") => json!("tool_use"),
        Some("stop") => json!("end_turn"),
        Some(_) => json!("end_turn"),
        None => Value::Null,
    }
}

// ---------------------------------------------------------------------------
// Response translation: OpenAI SSE -> Anthropic SSE (streaming)
// ---------------------------------------------------------------------------

#[derive(PartialEq, Clone, Copy)]
enum OpenBlock {
    None,
    Text,
    Tool(u64),
}

struct Translator {
    model: String,
    started: bool,
    next_index: i64,
    open: OpenBlock,
    /// openai tool index -> anthropic block index.
    tool_index: std::collections::HashMap<u64, i64>,
    stop_reason: Value,
    input_tokens: u64,
    output_tokens: u64,
    finished: bool,
    line_buf: String,
}

impl Translator {
    fn new(model: String) -> Self {
        Self {
            model,
            started: false,
            next_index: 0,
            open: OpenBlock::None,
            tool_index: std::collections::HashMap::new(),
            stop_reason: Value::Null,
            input_tokens: 0,
            output_tokens: 0,
            finished: false,
            line_buf: String::new(),
        }
    }

    fn feed(&mut self, chunk: &[u8], out: &mut VecDeque<Bytes>) {
        self.line_buf.push_str(&String::from_utf8_lossy(chunk));
        while let Some(idx) = self.line_buf.find('\n') {
            let line: String = self.line_buf.drain(..=idx).collect();
            let line = line.trim();
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data.is_empty() {
                continue;
            }
            if data == "[DONE]" {
                self.finish(out);
                continue;
            }
            if let Ok(v) = serde_json::from_str::<Value>(data) {
                self.handle_chunk(&v, out);
            }
        }
    }

    fn ensure_started(&mut self, chunk: &Value, out: &mut VecDeque<Bytes>) {
        if self.started {
            return;
        }
        self.started = true;
        if let Some(u) = chunk.get("usage") {
            if let Some(n) = u.get("prompt_tokens").and_then(|x| x.as_u64()) {
                self.input_tokens = n;
            }
        }
        let id = chunk.get("id").and_then(|v| v.as_str()).unwrap_or("msg");
        let msg = json!({
            "type": "message_start",
            "message": {
                "id": id,
                "type": "message",
                "role": "assistant",
                "model": self.model,
                "content": [],
                "stop_reason": Value::Null,
                "stop_sequence": Value::Null,
                "usage": { "input_tokens": self.input_tokens, "output_tokens": 0 }
            }
        });
        push_event(out, "message_start", &msg);
    }

    fn close_open(&mut self, out: &mut VecDeque<Bytes>) {
        let index = match self.open {
            OpenBlock::None => return,
            OpenBlock::Text => self.text_block_index(),
            OpenBlock::Tool(oai) => *self.tool_index.get(&oai).unwrap_or(&0),
        };
        push_event(
            out,
            "content_block_stop",
            &json!({ "type": "content_block_stop", "index": index }),
        );
        self.open = OpenBlock::None;
    }

    fn text_block_index(&self) -> i64 {
        // Text always uses index assigned when first opened; we store it as -1
        // sentinel resolved at open time. For simplicity text uses index stored
        // in tool_index under key u64::MAX.
        *self.tool_index.get(&u64::MAX).unwrap_or(&0)
    }

    fn handle_chunk(&mut self, chunk: &Value, out: &mut VecDeque<Bytes>) {
        self.ensure_started(chunk, out);

        if let Some(u) = chunk.get("usage").filter(|u| !u.is_null()) {
            if let Some(n) = u.get("completion_tokens").and_then(|x| x.as_u64()) {
                self.output_tokens = n;
            }
            if let Some(n) = u.get("prompt_tokens").and_then(|x| x.as_u64()) {
                self.input_tokens = n;
            }
        }

        let Some(choice) = chunk
            .get("choices")
            .and_then(|c| c.as_array())
            .and_then(|c| c.first())
        else {
            return;
        };

        if let Some(delta) = choice.get("delta") {
            if let Some(text) = delta.get("content").and_then(|c| c.as_str()) {
                if !text.is_empty() {
                    self.emit_text(text, out);
                }
            }
            if let Some(calls) = delta.get("tool_calls").and_then(|c| c.as_array()) {
                for call in calls {
                    self.emit_tool(call, out);
                }
            }
        }

        if let Some(finish) = choice.get("finish_reason").and_then(|f| f.as_str()) {
            self.stop_reason = map_stop_reason(Some(finish));
        }
    }

    fn emit_text(&mut self, text: &str, out: &mut VecDeque<Bytes>) {
        if self.open != OpenBlock::Text {
            self.close_open(out);
            let index = self.next_index;
            self.next_index += 1;
            self.tool_index.insert(u64::MAX, index);
            self.open = OpenBlock::Text;
            push_event(
                out,
                "content_block_start",
                &json!({
                    "type": "content_block_start",
                    "index": index,
                    "content_block": { "type": "text", "text": "" }
                }),
            );
        }
        let index = self.text_block_index();
        push_event(
            out,
            "content_block_delta",
            &json!({
                "type": "content_block_delta",
                "index": index,
                "delta": { "type": "text_delta", "text": text }
            }),
        );
    }

    fn emit_tool(&mut self, call: &Value, out: &mut VecDeque<Bytes>) {
        let oai_idx = call.get("index").and_then(|v| v.as_u64()).unwrap_or(0);
        let is_new = !self.tool_index.contains_key(&oai_idx);
        if is_new || self.open != OpenBlock::Tool(oai_idx) {
            self.close_open(out);
        }
        if is_new {
            let index = self.next_index;
            self.next_index += 1;
            self.tool_index.insert(oai_idx, index);
            let id = call.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let name = call
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            push_event(
                out,
                "content_block_start",
                &json!({
                    "type": "content_block_start",
                    "index": index,
                    "content_block": { "type": "tool_use", "id": id, "name": name, "input": {} }
                }),
            );
        }
        self.open = OpenBlock::Tool(oai_idx);
        if let Some(args) = call
            .get("function")
            .and_then(|f| f.get("arguments"))
            .and_then(|v| v.as_str())
        {
            if !args.is_empty() {
                let index = *self.tool_index.get(&oai_idx).unwrap_or(&0);
                push_event(
                    out,
                    "content_block_delta",
                    &json!({
                        "type": "content_block_delta",
                        "index": index,
                        "delta": { "type": "input_json_delta", "partial_json": args }
                    }),
                );
            }
        }
    }

    fn finish(&mut self, out: &mut VecDeque<Bytes>) {
        if self.finished {
            return;
        }
        self.finished = true;
        if !self.started {
            // Nothing streamed; still emit a minimal message frame.
            self.ensure_started(&json!({}), out);
        }
        self.close_open(out);
        let stop = if self.stop_reason.is_null() {
            json!("end_turn")
        } else {
            self.stop_reason.clone()
        };
        push_event(
            out,
            "message_delta",
            &json!({
                "type": "message_delta",
                "delta": { "stop_reason": stop, "stop_sequence": Value::Null },
                "usage": { "output_tokens": self.output_tokens }
            }),
        );
        push_event(out, "message_stop", &json!({ "type": "message_stop" }));
    }

    fn tokens(&self) -> Option<(Option<u64>, Option<u64>, Option<u64>)> {
        if self.input_tokens == 0 && self.output_tokens == 0 {
            None
        } else {
            let total = self.input_tokens + self.output_tokens;
            Some((
                Some(self.input_tokens),
                Some(self.output_tokens),
                Some(total),
            ))
        }
    }
}

fn push_event(out: &mut VecDeque<Bytes>, event: &str, data: &Value) {
    let frame = format!("event: {event}\ndata: {data}\n\n");
    out.push_back(Bytes::from(frame));
}

type UpstreamStream = Pin<Box<dyn Stream<Item = reqwest::Result<Bytes>> + Send>>;

struct AnthropicStream {
    inner: UpstreamStream,
    translator: Translator,
    queue: VecDeque<Bytes>,
    ctx: AppCtx,
    log: Option<LogBuilder>,
    status: u16,
    done: bool,
    emitted: bool,
}

impl AnthropicStream {
    fn new(
        ctx: AppCtx,
        inner: UpstreamStream,
        translator: Translator,
        log: LogBuilder,
        status: u16,
    ) -> Self {
        Self {
            inner,
            translator,
            queue: VecDeque::new(),
            ctx,
            log: Some(log),
            status,
            done: false,
            emitted: false,
        }
    }

    fn emit_final(&mut self, error: Option<String>) {
        if self.emitted {
            return;
        }
        self.emitted = true;
        if let Some(builder) = self.log.take() {
            let rec = builder.finish(self.status, self.translator.tokens(), error);
            let ctx = self.ctx.clone();
            tauri::async_runtime::spawn(async move {
                emit_log(&ctx, rec).await;
            });
        }
    }
}

impl Stream for AnthropicStream {
    type Item = Result<Bytes, std::io::Error>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        loop {
            if let Some(b) = self.queue.pop_front() {
                return Poll::Ready(Some(Ok(b)));
            }
            if self.done {
                self.emit_final(None);
                return Poll::Ready(None);
            }
            match self.inner.as_mut().poll_next(cx) {
                Poll::Ready(Some(Ok(bytes))) => {
                    let this = &mut *self;
                    this.translator.feed(&bytes, &mut this.queue);
                }
                Poll::Ready(Some(Err(e))) => {
                    let msg = e.to_string();
                    let this = &mut *self;
                    this.translator.finish(&mut this.queue);
                    self.done = true;
                    self.emit_final(Some(msg));
                }
                Poll::Ready(None) => {
                    let this = &mut *self;
                    this.translator.finish(&mut this.queue);
                    self.done = true;
                }
                Poll::Pending => return Poll::Pending,
            }
        }
    }
}
