//! MCP Inspector backend.
//!
//! Implements a minimal Model Context Protocol client used by the Inspector UI
//! to connect to a configured server, run the `initialize` handshake and list /
//! call its tools, resources and prompts.
//!
//! Three transports are supported:
//! - `stdio`: spawn the command and exchange newline-delimited JSON-RPC.
//! - `http`: the Streamable HTTP transport (POST + optional `text/event-stream`).
//! - `sse`: the legacy HTTP+SSE transport (GET stream + POST endpoint).
//!
//! Sessions are pooled by [`McpSessions`] (a Tauri-managed state) and keyed by
//! the server config, so the (potentially slow) connect + `initialize` handshake
//! happens once per server and is reused across `inspect` / `call` / `read` /
//! `get` requests. Idle sessions are evicted after [`SESSION_TTL`]; a stale or
//! dropped connection is transparently reopened and the failing request retried
//! once.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::{oneshot, Mutex};
use tokio::time::timeout;

const PROTOCOL_VERSION: &str = "2025-06-18";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const CLIENT_NAME: &str = "LLMToolForge Inspector";
/// Idle lifetime after which a pooled session is closed and reopened on demand.
const SESSION_TTL: Duration = Duration::from_secs(300);

/// Subset of the persisted MCP server record the inspector needs to connect.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub transport: String,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

/// Full snapshot returned after a successful connect + handshake.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectSnapshot {
    pub protocol_version: Option<String>,
    pub server_info: Value,
    pub capabilities: Value,
    pub instructions: Option<String>,
    pub tools: Vec<Value>,
    pub resources: Vec<Value>,
    pub resource_templates: Vec<Value>,
    pub prompts: Vec<Value>,
}

/// Extract the `result` from a JSON-RPC response, or turn an `error` into `Err`.
fn parse_rpc_result(message: Value) -> Result<Value, String> {
    if let Some(err) = message.get("error") {
        let code = err.get("code").and_then(Value::as_i64).unwrap_or(0);
        let msg = err
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown error");
        let data = err.get("data");
        let suffix = match data {
            Some(d) if !d.is_null() => format!(" ({d})"),
            _ => String::new(),
        };
        return Err(format!("RPC error {code}: {msg}{suffix}"));
    }
    Ok(message.get("result").cloned().unwrap_or(Value::Null))
}

/// A connected session over one of the three transports.
enum Session {
    Stdio(Box<StdioSession>),
    Http(HttpSession),
    Sse(SseSession),
}

impl Session {
    async fn open(cfg: &McpServerConfig) -> Result<(Session, Value), String> {
        let mut session = match cfg.transport.as_str() {
            "stdio" => Session::Stdio(Box::new(StdioSession::connect(cfg).await?)),
            "http" => Session::Http(HttpSession::connect(cfg)?),
            "sse" => Session::Sse(SseSession::connect(cfg).await?),
            other => return Err(format!("不支持的传输方式: {other}")),
        };

        let init = session
            .request(
                "initialize",
                json!({
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": { "name": CLIENT_NAME, "version": env!("CARGO_PKG_VERSION") }
                }),
            )
            .await?;

        // Best-effort: servers tolerate the initialized notification arriving late.
        let _ = session.notify("notifications/initialized", json!({})).await;

        Ok((session, init))
    }

    async fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        match self {
            Session::Stdio(s) => {
                let id = s.next_id();
                s.rpc(id, method, params).await
            }
            Session::Http(s) => {
                let id = s.next_id();
                s.rpc(id, method, params).await
            }
            Session::Sse(s) => {
                let id = s.next_id();
                s.rpc(id, method, params).await
            }
        }
    }

    async fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        match self {
            Session::Stdio(s) => s.notify(method, params).await,
            Session::Http(s) => s.notify(method, params).await,
            Session::Sse(s) => s.notify(method, params).await,
        }
    }
}

// ---------------------------------------------------------------------------
// stdio transport
// ---------------------------------------------------------------------------

struct StdioSession {
    _child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    id: i64,
}

impl StdioSession {
    fn next_id(&mut self) -> i64 {
        self.id += 1;
        self.id
    }

    async fn connect(cfg: &McpServerConfig) -> Result<Self, String> {
        let command = cfg
            .command
            .as_deref()
            .map(str::trim)
            .filter(|c| !c.is_empty())
            .ok_or_else(|| "stdio 服务器缺少启动命令".to_string())?;

        let mut cmd = tokio::process::Command::new(command);
        cmd.args(&cfg.args);
        for (k, v) in &cfg.env {
            cmd.env(k, v);
        }
        cmd.stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);

        let mut child = cmd.spawn().map_err(|e| format!("启动命令失败: {e}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "无法获取 stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "无法获取 stdout".to_string())?;

        Ok(StdioSession {
            _child: child,
            stdin,
            stdout: BufReader::new(stdout),
            id: 0,
        })
    }

    async fn rpc(&mut self, id: i64, method: &str, params: Value) -> Result<Value, String> {
        let msg = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        self.write_line(&msg).await?;

        let read = async {
            loop {
                let mut line = String::new();
                let n = self
                    .stdout
                    .read_line(&mut line)
                    .await
                    .map_err(|e| format!("读取响应失败: {e}"))?;
                if n == 0 {
                    return Err("服务器已关闭连接".to_string());
                }
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let value: Value = match serde_json::from_str(trimmed) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if value.get("id").and_then(Value::as_i64) == Some(id) {
                    return parse_rpc_result(value);
                }
                // Server-initiated request/notification — ignore for the inspector.
            }
        };

        timeout(REQUEST_TIMEOUT, read)
            .await
            .map_err(|_| format!("请求 {method} 超时"))?
    }

    async fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        let msg = json!({ "jsonrpc": "2.0", "method": method, "params": params });
        self.write_line(&msg).await
    }

    async fn write_line(&mut self, msg: &Value) -> Result<(), String> {
        let mut line = serde_json::to_string(msg).map_err(|e| e.to_string())?;
        line.push('\n');
        self.stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("写入失败: {e}"))?;
        self.stdin
            .flush()
            .await
            .map_err(|e| format!("写入失败: {e}"))
    }
}

// ---------------------------------------------------------------------------
// Streamable HTTP transport
// ---------------------------------------------------------------------------

struct HttpSession {
    client: reqwest::Client,
    url: String,
    session_id: Option<String>,
    id: i64,
}

impl HttpSession {
    fn next_id(&mut self) -> i64 {
        self.id += 1;
        self.id
    }

    fn connect(cfg: &McpServerConfig) -> Result<Self, String> {
        let url = cfg
            .url
            .as_deref()
            .map(str::trim)
            .filter(|u| !u.is_empty())
            .ok_or_else(|| "HTTP 服务器缺少 URL".to_string())?
            .to_string();
        let client = reqwest::Client::builder()
            .build()
            .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
        Ok(HttpSession {
            client,
            url,
            session_id: None,
            id: 0,
        })
    }

    async fn rpc(&mut self, id: i64, method: &str, params: Value) -> Result<Value, String> {
        let body = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        let message = self.post(&body, Some(id), method).await?;
        parse_rpc_result(message)
    }

    async fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        let body = json!({ "jsonrpc": "2.0", "method": method, "params": params });
        self.post(&body, None, method).await.map(|_| ())
    }

    async fn post(
        &mut self,
        body: &Value,
        want_id: Option<i64>,
        method: &str,
    ) -> Result<Value, String> {
        let mut req = self
            .client
            .post(&self.url)
            .header("content-type", "application/json")
            .header("accept", "application/json, text/event-stream")
            .header("mcp-protocol-version", PROTOCOL_VERSION);
        if let Some(sid) = &self.session_id {
            req = req.header("mcp-session-id", sid.as_str());
        }
        req = req.json(body);

        let resp = timeout(REQUEST_TIMEOUT, req.send())
            .await
            .map_err(|_| format!("请求 {method} 超时"))?
            .map_err(|e| format!("请求失败: {e}"))?;

        if let Some(sid) = resp.headers().get("mcp-session-id") {
            if let Ok(s) = sid.to_str() {
                self.session_id = Some(s.to_string());
            }
        }

        let status = resp.status();
        let ctype = resp
            .headers()
            .get("content-type")
            .and_then(|c| c.to_str().ok())
            .unwrap_or("")
            .to_string();

        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("HTTP {status}: {text}"));
        }

        // Notifications / responses with no payload (202 Accepted).
        let want_id = match want_id {
            Some(id) => id,
            None => return Ok(Value::Null),
        };

        if ctype.contains("text/event-stream") {
            read_sse_response(resp, want_id).await
        } else if status.as_u16() == 202 || ctype.is_empty() {
            Err("服务器未返回响应内容".to_string())
        } else {
            resp.json::<Value>()
                .await
                .map_err(|e| format!("解析响应失败: {e}"))
        }
    }
}

/// Read a Streamable-HTTP POST response delivered as an SSE stream and return
/// the JSON-RPC message whose `id` matches `want_id`.
async fn read_sse_response(mut resp: reqwest::Response, want_id: i64) -> Result<Value, String> {
    let read = async {
        let mut buffer = String::new();
        loop {
            let chunk = resp
                .chunk()
                .await
                .map_err(|e| format!("读取响应流失败: {e}"))?;
            let Some(bytes) = chunk else {
                return Err("响应流提前结束".to_string());
            };
            buffer.push_str(&String::from_utf8_lossy(&bytes));
            for (_event, data) in drain_sse_events(&mut buffer) {
                if data.is_empty() {
                    continue;
                }
                if let Ok(value) = serde_json::from_str::<Value>(&data) {
                    if value.get("id").and_then(Value::as_i64) == Some(want_id) {
                        return Ok(value);
                    }
                }
            }
        }
    };

    timeout(REQUEST_TIMEOUT, read)
        .await
        .map_err(|_| "等待响应超时".to_string())?
}

// ---------------------------------------------------------------------------
// Legacy HTTP + SSE transport
// ---------------------------------------------------------------------------

struct SseSession {
    client: reqwest::Client,
    post_url: String,
    pending: Arc<Mutex<HashMap<i64, oneshot::Sender<Value>>>>,
    _reader: tokio::task::JoinHandle<()>,
    id: i64,
}

impl SseSession {
    fn next_id(&mut self) -> i64 {
        self.id += 1;
        self.id
    }

    async fn connect(cfg: &McpServerConfig) -> Result<Self, String> {
        let url = cfg
            .url
            .as_deref()
            .map(str::trim)
            .filter(|u| !u.is_empty())
            .ok_or_else(|| "SSE 服务器缺少 URL".to_string())?
            .to_string();
        let base = reqwest::Url::parse(&url).map_err(|e| format!("无效的 URL: {e}"))?;
        let client = reqwest::Client::new();

        let resp = timeout(
            CONNECT_TIMEOUT,
            client
                .get(url.clone())
                .header("accept", "text/event-stream")
                .send(),
        )
        .await
        .map_err(|_| "连接 SSE 超时".to_string())?
        .map_err(|e| format!("连接失败: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }

        let pending: Arc<Mutex<HashMap<i64, oneshot::Sender<Value>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let (endpoint_tx, endpoint_rx) = oneshot::channel::<String>();
        let reader_pending = pending.clone();
        let reader =
            tokio::spawn(
                async move { sse_reader_loop(resp, base, endpoint_tx, reader_pending).await },
            );

        let post_url = timeout(CONNECT_TIMEOUT, endpoint_rx)
            .await
            .map_err(|_| "等待 endpoint 超时".to_string())?
            .map_err(|_| "未收到 endpoint 事件".to_string())?;

        Ok(SseSession {
            client,
            post_url,
            pending,
            _reader: reader,
            id: 0,
        })
    }

    async fn rpc(&mut self, id: i64, method: &str, params: Value) -> Result<Value, String> {
        let (tx, rx) = oneshot::channel::<Value>();
        self.pending.lock().await.insert(id, tx);

        let body = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        let send = self
            .client
            .post(&self.post_url)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await;

        if let Err(e) = send.and_then(|r| r.error_for_status()) {
            self.pending.lock().await.remove(&id);
            return Err(format!("请求失败: {e}"));
        }

        let value = timeout(REQUEST_TIMEOUT, rx)
            .await
            .map_err(|_| format!("请求 {method} 超时"))?
            .map_err(|_| "连接已关闭".to_string())?;
        parse_rpc_result(value)
    }

    async fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        let body = json!({ "jsonrpc": "2.0", "method": method, "params": params });
        self.client
            .post(&self.post_url)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("请求失败: {e}"))?;
        Ok(())
    }
}

/// Background task that reads the SSE GET stream, resolves the POST endpoint and
/// dispatches JSON-RPC responses to the matching pending request.
async fn sse_reader_loop(
    mut resp: reqwest::Response,
    base: reqwest::Url,
    endpoint_tx: oneshot::Sender<String>,
    pending: Arc<Mutex<HashMap<i64, oneshot::Sender<Value>>>>,
) {
    let mut endpoint_tx = Some(endpoint_tx);
    let mut buffer = String::new();
    loop {
        let chunk = match resp.chunk().await {
            Ok(Some(bytes)) => bytes,
            _ => break,
        };
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        for (event, data) in drain_sse_events(&mut buffer) {
            let kind = event.as_deref().unwrap_or("message");
            match kind {
                "endpoint" => {
                    if let Some(tx) = endpoint_tx.take() {
                        let resolved = base
                            .join(data.trim())
                            .map(|u| u.to_string())
                            .unwrap_or_else(|_| data.trim().to_string());
                        let _ = tx.send(resolved);
                    }
                }
                _ => {
                    if let Ok(value) = serde_json::from_str::<Value>(&data) {
                        if let Some(id) = value.get("id").and_then(Value::as_i64) {
                            if let Some(tx) = pending.lock().await.remove(&id) {
                                let _ = tx.send(value);
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Pull all complete SSE events (`...\n\n`) out of `buffer`, returning
/// `(event, data)` pairs. Partial trailing data is left in the buffer.
fn drain_sse_events(buffer: &mut String) -> Vec<(Option<String>, String)> {
    let normalized = buffer.replace("\r\n", "\n").replace('\r', "\n");
    *buffer = normalized;

    let mut events = Vec::new();
    while let Some(idx) = buffer.find("\n\n") {
        let block: String = buffer.drain(..idx + 2).collect();
        let mut event: Option<String> = None;
        let mut data_lines: Vec<String> = Vec::new();
        for line in block.split('\n') {
            if line.is_empty() {
                continue;
            }
            if let Some(rest) = line.strip_prefix("event:") {
                event = Some(rest.trim().to_string());
            } else if let Some(rest) = line.strip_prefix("data:") {
                data_lines.push(rest.strip_prefix(' ').unwrap_or(rest).to_string());
            }
        }
        events.push((event, data_lines.join("\n")));
    }
    events
}

// ---------------------------------------------------------------------------
// Listing helpers
// ---------------------------------------------------------------------------

/// Collect every item from a `*/list` method, following `nextCursor` pagination.
/// Returns an empty list if the method is unsupported.
async fn collect_list(session: &mut Session, method: &str, key: &str) -> Vec<Value> {
    let mut out = Vec::new();
    let mut cursor: Option<String> = None;
    for _ in 0..50 {
        let params = match &cursor {
            Some(c) => json!({ "cursor": c }),
            None => json!({}),
        };
        let result = match session.request(method, params).await {
            Ok(r) => r,
            Err(_) => break,
        };
        if let Some(arr) = result.get(key).and_then(Value::as_array) {
            out.extend(arr.iter().cloned());
        }
        match result.get("nextCursor").and_then(Value::as_str) {
            Some(c) if !c.is_empty() => cursor = Some(c.to_string()),
            _ => break,
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Session pool
// ---------------------------------------------------------------------------

/// A live, initialized session kept alive for reuse.
struct PooledSession {
    session: Session,
    /// The `initialize` result captured when the session was opened.
    init: Value,
    last_used: Instant,
}

/// Tauri-managed pool of live MCP sessions, keyed by server config.
///
/// Reusing a session avoids the connect + `initialize` round-trip (and, for
/// stdio servers, a full process spawn) on every command, which is the dominant
/// cost when an agent inspects a server and then calls its tools repeatedly.
#[derive(Default)]
pub struct McpSessions {
    map: Mutex<HashMap<String, Arc<Mutex<PooledSession>>>>,
}

/// Stable identity for a server config, so equivalent configs share a session.
fn session_key(cfg: &McpServerConfig) -> String {
    let mut env: Vec<(&String, &String)> = cfg.env.iter().collect();
    env.sort();
    format!(
        "{}\u{1}{}\u{1}{}\u{1}{}\u{1}{:?}",
        cfg.transport,
        cfg.command.as_deref().unwrap_or(""),
        cfg.url.as_deref().unwrap_or(""),
        cfg.args.join("\u{2}"),
        env,
    )
}

impl McpSessions {
    /// Return a live session for `cfg`, opening one if none is cached. The bool
    /// is `true` when the session was freshly opened (so callers can skip a
    /// reconnect-retry that would needlessly re-spawn a slow/broken server).
    /// Also sweeps idle sessions so long-lived processes (stdio children) are
    /// reaped.
    async fn acquire(
        &self,
        cfg: &McpServerConfig,
    ) -> Result<(Arc<Mutex<PooledSession>>, bool), String> {
        let key = session_key(cfg);
        {
            let mut map = self.map.lock().await;
            let now = Instant::now();
            // Drop sessions that have been idle past the TTL. Entries currently
            // in use (locked) are kept; their `last_used` is refreshed on use.
            map.retain(|_, entry| match entry.try_lock() {
                Ok(pooled) => now.duration_since(pooled.last_used) < SESSION_TTL,
                Err(_) => true,
            });
            if let Some(existing) = map.get(&key) {
                return Ok((existing.clone(), false));
            }
        }

        // Open outside the map lock so a slow handshake doesn't block other
        // servers, then double-check in case of a concurrent open.
        let (session, init) = Session::open(cfg).await?;
        let pooled = Arc::new(Mutex::new(PooledSession {
            session,
            init,
            last_used: Instant::now(),
        }));
        let mut map = self.map.lock().await;
        if let Some(existing) = map.get(&key) {
            return Ok((existing.clone(), false));
        }
        map.insert(key, pooled.clone());
        Ok((pooled, true))
    }

    /// Drop the cached session for `cfg` (e.g. after a transport error), forcing
    /// the next request to reconnect.
    async fn evict(&self, cfg: &McpServerConfig) {
        self.map.lock().await.remove(&session_key(cfg));
    }
}

/// Run `op` against a pooled session. If the session was *reused* (and may have
/// gone stale) and the request fails, evict it and retry once with a fresh
/// session. A freshly-opened session is not retried, so a slow/broken server is
/// not connected twice per call.
async fn with_session<T, F, Fut>(
    sessions: &McpSessions,
    cfg: &McpServerConfig,
    op: F,
) -> Result<T, String>
where
    F: Fn(Arc<Mutex<PooledSession>>) -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let (pooled, fresh) = sessions.acquire(cfg).await?;
    match op(pooled).await {
        Ok(value) => Ok(value),
        Err(first) if !fresh => {
            sessions.evict(cfg).await;
            let (pooled, _) = sessions
                .acquire(cfg)
                .await
                .map_err(|reopen| format!("{first} (重连失败: {reopen})"))?;
            op(pooled).await
        }
        Err(first) => {
            // The connection was just opened; a failure is unlikely to be a
            // stale-session problem, so surface it without re-spawning.
            sessions.evict(cfg).await;
            Err(first)
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn mcp_inspect(
    sessions: State<'_, McpSessions>,
    config: McpServerConfig,
) -> Result<InspectSnapshot, String> {
    with_session(&sessions, &config, |pooled| async move {
        let mut guard = pooled.lock().await;
        guard.last_used = Instant::now();
        let init = guard.init.clone();
        let session = &mut guard.session;

        let capabilities = init.get("capabilities").cloned().unwrap_or(json!({}));
        let has = |key: &str| capabilities.get(key).is_some();

        // Tools are the primary inspector feature; attempt the listing even when
        // a server under-advertises its capabilities (errors yield an empty list).
        let tools = collect_list(session, "tools/list", "tools").await;
        let (resources, resource_templates) = if has("resources") {
            (
                collect_list(session, "resources/list", "resources").await,
                collect_list(session, "resources/templates/list", "resourceTemplates").await,
            )
        } else {
            (Vec::new(), Vec::new())
        };
        let prompts = if has("prompts") {
            collect_list(session, "prompts/list", "prompts").await
        } else {
            Vec::new()
        };

        Ok(InspectSnapshot {
            protocol_version: init
                .get("protocolVersion")
                .and_then(Value::as_str)
                .map(str::to_string),
            server_info: init.get("serverInfo").cloned().unwrap_or(json!({})),
            capabilities,
            instructions: init
                .get("instructions")
                .and_then(Value::as_str)
                .map(str::to_string),
            tools,
            resources,
            resource_templates,
            prompts,
        })
    })
    .await
}

#[tauri::command]
pub async fn mcp_call_tool(
    sessions: State<'_, McpSessions>,
    config: McpServerConfig,
    name: String,
    arguments: Value,
) -> Result<Value, String> {
    with_session(&sessions, &config, |pooled| {
        let name = name.clone();
        let arguments = arguments.clone();
        async move {
            let mut guard = pooled.lock().await;
            guard.last_used = Instant::now();
            guard
                .session
                .request(
                    "tools/call",
                    json!({ "name": name, "arguments": arguments }),
                )
                .await
        }
    })
    .await
}

#[tauri::command]
pub async fn mcp_read_resource(
    sessions: State<'_, McpSessions>,
    config: McpServerConfig,
    uri: String,
) -> Result<Value, String> {
    with_session(&sessions, &config, |pooled| {
        let uri = uri.clone();
        async move {
            let mut guard = pooled.lock().await;
            guard.last_used = Instant::now();
            guard
                .session
                .request("resources/read", json!({ "uri": uri }))
                .await
        }
    })
    .await
}

#[tauri::command]
pub async fn mcp_get_prompt(
    sessions: State<'_, McpSessions>,
    config: McpServerConfig,
    name: String,
    arguments: Value,
) -> Result<Value, String> {
    with_session(&sessions, &config, |pooled| {
        let name = name.clone();
        let arguments = arguments.clone();
        async move {
            let mut guard = pooled.lock().await;
            guard.last_used = Instant::now();
            guard
                .session
                .request(
                    "prompts/get",
                    json!({ "name": name, "arguments": arguments }),
                )
                .await
        }
    })
    .await
}
