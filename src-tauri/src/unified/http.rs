//! HTTP router, auth, request forwarding and call logging for the unified API.

use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Instant;

use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use bytes::Bytes;
use futures_util::Stream;
use serde_json::json;
use tauri::Emitter;
use tokio::sync::RwLock;

use super::{now_ms, CallLogRecord, SharedState, Upstream, CALL_LOG_EVENT};

#[derive(Clone)]
pub struct AppCtx {
    pub shared: Arc<RwLock<SharedState>>,
    pub client: reqwest::Client,
    pub app: tauri::AppHandle,
}

pub fn router(ctx: AppCtx) -> Router {
    Router::new()
        .route("/v1/models", get(super::openai::list_models))
        .route(
            "/v1/chat/completions",
            post(super::openai::chat_completions),
        )
        .route(
            "/v1/images/generations",
            post(super::openai::images_generations),
        )
        .route("/v1/images/edits", post(super::openai::images_edits))
        .route(
            "/v1/images/variations",
            post(super::openai::images_variations),
        )
        .route("/v1/messages", post(super::anthropic::messages))
        .route("/openapi.json", get(super::openapi::spec))
        .route("/docs", get(super::openapi::docs))
        .route("/", get(super::openapi::docs))
        .fallback(not_found)
        .with_state(ctx)
}

async fn not_found() -> Response {
    json_error(StatusCode::NOT_FOUND, "未找到该端点")
}

/// Build an OpenAI-style JSON error response.
pub fn json_error(status: StatusCode, message: &str) -> Response {
    let body = json!({
        "error": { "message": message, "type": "unified_api_error", "code": status.as_u16() }
    });
    (status, axum::Json(body)).into_response()
}

/// Verify the optional local bearer key. Returns an error response when invalid.
pub async fn check_auth(ctx: &AppCtx, headers: &HeaderMap) -> Result<(), Response> {
    let expected = {
        let shared = ctx.shared.read().await;
        shared.local_key.clone()
    };
    let Some(expected) = expected else {
        return Ok(());
    };
    let presented = bearer(headers).or_else(|| {
        headers
            .get("x-api-key")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
    });
    match presented {
        Some(key) if key == expected => Ok(()),
        _ => Err(json_error(StatusCode::UNAUTHORIZED, "无效的本地 API Key")),
    }
}

fn bearer(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get("authorization")?.to_str().ok()?;
    raw.strip_prefix("Bearer ")
        .or_else(|| raw.strip_prefix("bearer "))
        .map(|s| s.trim().to_string())
}

pub fn user_agent(headers: &HeaderMap) -> Option<String> {
    headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

/// Look up the upstream for an exposed model id.
pub async fn lookup(ctx: &AppCtx, model: &str) -> Option<Upstream> {
    let shared = ctx.shared.read().await;
    shared.routes.get(model).cloned()
}

/// POST a chat-completions body to the upstream.
pub async fn post_chat(
    ctx: &AppCtx,
    upstream: &Upstream,
    body: &serde_json::Value,
) -> reqwest::Result<reqwest::Response> {
    post_path(ctx, upstream, "chat/completions", body).await
}

/// POST an arbitrary JSON body to `{base_url}/{path}` on the upstream.
pub async fn post_path(
    ctx: &AppCtx,
    upstream: &Upstream,
    path: &str,
    body: &serde_json::Value,
) -> reqwest::Result<reqwest::Response> {
    let url = format!("{}/{}", upstream.base_url, path);
    ctx.client
        .post(url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", upstream.api_key))
        .json(body)
        .send()
        .await
}

/// Builder accumulating the fields of a call log.
pub struct LogBuilder {
    pub started: Instant,
    pub ts: u64,
    pub exposed_model: String,
    pub real_model: String,
    pub provider: String,
    pub protocol: &'static str,
    pub stream: bool,
    pub user_agent: Option<String>,
}

impl LogBuilder {
    pub fn new(
        meta_model: &str,
        upstream: &Upstream,
        protocol: &'static str,
        stream: bool,
        user_agent: Option<String>,
    ) -> Self {
        Self {
            started: Instant::now(),
            ts: now_ms(),
            exposed_model: meta_model.to_string(),
            real_model: upstream.real_model.clone(),
            provider: upstream.provider.clone(),
            protocol,
            stream,
            user_agent,
        }
    }

    pub fn finish(
        &self,
        status: u16,
        tokens: Option<(Option<u64>, Option<u64>, Option<u64>)>,
        error: Option<String>,
    ) -> CallLogRecord {
        let (p, c, t) = tokens.unwrap_or((None, None, None));
        CallLogRecord {
            id: 0,
            ts: self.ts,
            exposed_model: self.exposed_model.clone(),
            real_model: self.real_model.clone(),
            provider: self.provider.clone(),
            protocol: self.protocol.to_string(),
            stream: self.stream,
            status,
            duration_ms: self.started.elapsed().as_millis(),
            prompt_tokens: p,
            completion_tokens: c,
            total_tokens: t,
            error,
            user_agent: self.user_agent.clone(),
        }
    }
}

/// Push a record into the ring buffer and emit it to the frontend.
pub async fn emit_log(ctx: &AppCtx, rec: CallLogRecord) {
    let stored = {
        let mut shared = ctx.shared.write().await;
        shared.push_log(rec)
    };
    let _ = ctx.app.emit(CALL_LOG_EVENT, &stored);
}

/// Parses OpenAI SSE bytes incrementally to capture `usage` when present.
#[derive(Default)]
pub struct UsageParser {
    line_buf: String,
    pub prompt: Option<u64>,
    pub completion: Option<u64>,
    pub total: Option<u64>,
}

impl UsageParser {
    pub fn feed(&mut self, chunk: &[u8]) {
        self.line_buf.push_str(&String::from_utf8_lossy(chunk));
        while let Some(idx) = self.line_buf.find('\n') {
            let line: String = self.line_buf.drain(..=idx).collect();
            let line = line.trim();
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data.is_empty() || data == "[DONE]" {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                self.absorb(&v);
            }
        }
    }

    fn absorb(&mut self, v: &serde_json::Value) {
        if let Some(usage) = v.get("usage").filter(|u| !u.is_null()) {
            if let Some(n) = usage.get("prompt_tokens").and_then(|x| x.as_u64()) {
                self.prompt = Some(n);
            }
            if let Some(n) = usage.get("completion_tokens").and_then(|x| x.as_u64()) {
                self.completion = Some(n);
            }
            if let Some(n) = usage.get("total_tokens").and_then(|x| x.as_u64()) {
                self.total = Some(n);
            }
        }
    }

    pub fn tokens(&self) -> Option<(Option<u64>, Option<u64>, Option<u64>)> {
        if self.prompt.is_none() && self.completion.is_none() && self.total.is_none() {
            None
        } else {
            Some((self.prompt, self.completion, self.total))
        }
    }
}

type UpstreamStream = Pin<Box<dyn Stream<Item = reqwest::Result<Bytes>> + Send>>;

/// Streaming body wrapper that passes SSE bytes through unchanged while parsing
/// usage, then emits the call log once the upstream stream completes.
pub struct LoggingStream {
    inner: UpstreamStream,
    parser: UsageParser,
    ctx: AppCtx,
    log: Option<LogBuilder>,
    status: u16,
    emitted: bool,
}

impl LoggingStream {
    pub fn new(ctx: AppCtx, inner: UpstreamStream, log: LogBuilder, status: u16) -> Self {
        Self {
            inner,
            parser: UsageParser::default(),
            ctx,
            log: Some(log),
            status,
            emitted: false,
        }
    }

    fn emit_final(&mut self, error: Option<String>) {
        if self.emitted {
            return;
        }
        self.emitted = true;
        if let Some(builder) = self.log.take() {
            let rec = builder.finish(self.status, self.parser.tokens(), error);
            let ctx = self.ctx.clone();
            tauri::async_runtime::spawn(async move {
                emit_log(&ctx, rec).await;
            });
        }
    }
}

impl Stream for LoggingStream {
    type Item = reqwest::Result<Bytes>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        match self.inner.as_mut().poll_next(cx) {
            Poll::Ready(Some(Ok(bytes))) => {
                self.parser.feed(&bytes);
                Poll::Ready(Some(Ok(bytes)))
            }
            Poll::Ready(Some(Err(e))) => {
                let msg = e.to_string();
                self.emit_final(Some(msg));
                Poll::Ready(Some(Err(e)))
            }
            Poll::Ready(None) => {
                self.emit_final(None);
                Poll::Ready(None)
            }
            Poll::Pending => Poll::Pending,
        }
    }
}

/// Build a streaming SSE response that forwards the upstream and logs on end.
pub fn sse_response(ctx: &AppCtx, log: LogBuilder, upstream: reqwest::Response) -> Response {
    let status = upstream.status().as_u16();
    let stream = LoggingStream::new(ctx.clone(), Box::pin(upstream.bytes_stream()), log, status);
    Response::builder()
        .status(status)
        .header("Content-Type", "text/event-stream")
        .header("Cache-Control", "no-cache")
        .header("Connection", "keep-alive")
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| json_error(StatusCode::INTERNAL_SERVER_ERROR, "无法构建流式响应"))
}

/// Re-export for handlers that need state extraction.
pub type Ctx = State<AppCtx>;
