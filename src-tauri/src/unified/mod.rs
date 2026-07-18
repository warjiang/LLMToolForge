//! Local unified API supervisor.
//!
//! Exposes the user's connected models through a local OpenAI- and
//! Anthropic-compatible HTTP server so external tools (Codex, Claude Code,
//! local agents) can call them. The HTTP server itself is the bundled Portkey
//! gateway sidecar (`binaries/portkey-gateway`), which handles all protocol
//! translation. This module supervises that process: it writes the routing
//! config the sidecar reads, spawns/stops it, health-checks it, and turns the
//! call-log lines the sidecar prints on stdout into the in-memory ring buffer
//! and `CALL_LOG_EVENT` the frontend monitoring UI consumes.
//!
//! Credentials live in the frontend; the frontend pushes a routing table
//! (`exposedModel -> upstream`) via `unified_api_set_config`. They are written
//! to a local config file the sidecar reads and never reach API clients.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::{Mutex, RwLock};

/// Max call-log records kept in the in-memory ring buffer.
const LOG_CAPACITY: usize = 2000;

/// Event name used to push each completed call log to the frontend.
pub const CALL_LOG_EVENT: &str = "unified://call-log";

/// Name of the bundled sidecar binary (see `externalBin` in `tauri.conf.json`).
const SIDECAR_NAME: &str = "portkey-gateway";

/// Prefix the sidecar uses to mark structured call-log lines on stdout.
const LOG_MARKER: &str = "@@LLMTF_CALLLOG@@";

/// Default port the gateway listens on until configured otherwise.
const DEFAULT_PORT: u16 = 4141;

/// An upstream target a given exposed model id routes to.
#[derive(Debug, Clone)]
pub struct Upstream {
    /// Base URL including the version segment, no trailing slash (e.g. `.../v1`).
    pub base_url: String,
    pub api_key: String,
    /// Real model id understood by the upstream.
    pub real_model: String,
    /// Provider key, for display/logging only.
    pub provider: String,
}

/// Shared routing + logging state. Read when writing the sidecar config file and
/// when serving status/logs/stats to the frontend.
#[derive(Debug, Default)]
pub struct SharedState {
    /// exposedModel -> upstream.
    pub routes: HashMap<String, Upstream>,
    /// Optional local bearer key clients must present. `None`/empty = no auth.
    pub local_key: Option<String>,
    /// In-memory ring buffer of recent call logs (newest at the back).
    pub logs: VecDeque<CallLogRecord>,
    /// Monotonic sequence for log ids.
    pub seq: u64,
}

impl SharedState {
    pub fn push_log(&mut self, mut rec: CallLogRecord) -> (CallLogRecord, Option<u64>) {
        self.seq += 1;
        rec.id = self.seq;
        let evicted = if self.logs.len() >= LOG_CAPACITY {
            self.logs.pop_front().map(|r| r.id)
        } else {
            None
        };
        self.logs.push_back(rec.clone());
        (rec, evicted)
    }

    /// Serialize the routing table into the JSON config the sidecar reads.
    fn to_config_json(&self) -> serde_json::Value {
        let mut routes = serde_json::Map::new();
        for (id, up) in &self.routes {
            routes.insert(
                id.clone(),
                json!({
                    "provider": up.provider,
                    "baseUrl": up.base_url,
                    "apiKey": up.api_key,
                    "realModel": up.real_model,
                }),
            );
        }
        json!({
            "localKey": self.local_key,
            "routes": routes,
        })
    }
}

/// A single model-call log record.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CallLogRecord {
    pub id: u64,
    /// Epoch milliseconds.
    pub ts: u64,
    pub exposed_model: String,
    pub real_model: String,
    pub provider: String,
    /// `openai-chat` or `anthropic`.
    pub protocol: String,
    pub stream: bool,
    pub status: u16,
    pub duration_ms: u128,
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
    pub error: Option<String>,
    pub user_agent: Option<String>,
    /// Whether a request body was captured to disk for this call.
    pub has_request_body: bool,
    /// Whether a response body was captured to disk for this call.
    pub has_response_body: bool,
}

/// Request/response bodies captured for a single call, persisted to disk and
/// loaded on demand (they can be large, so they never live in the ring buffer
/// or the logs list response).
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallBody {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_body: Option<String>,
}

/// Call-log line emitted by the sidecar on stdout (no `id`; we assign it).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarLog {
    ts: u64,
    exposed_model: String,
    real_model: String,
    provider: String,
    protocol: String,
    stream: bool,
    status: u16,
    duration_ms: u64,
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    total_tokens: Option<u64>,
    error: Option<String>,
    user_agent: Option<String>,
    #[serde(default)]
    request_body: Option<String>,
    #[serde(default)]
    response_body: Option<String>,
}

impl SidecarLog {
    /// Split the sidecar log into a lightweight ring-buffer record and the
    /// (optional) request/response bodies that get persisted separately.
    fn into_record(self) -> (CallLogRecord, CallBody) {
        let request_body = self.request_body.filter(|s| !s.is_empty());
        let response_body = self.response_body.filter(|s| !s.is_empty());
        let rec = CallLogRecord {
            id: 0,
            ts: self.ts,
            exposed_model: self.exposed_model,
            real_model: self.real_model,
            provider: self.provider,
            protocol: self.protocol,
            stream: self.stream,
            status: self.status,
            duration_ms: self.duration_ms as u128,
            prompt_tokens: self.prompt_tokens,
            completion_tokens: self.completion_tokens,
            total_tokens: self.total_tokens,
            error: self.error,
            user_agent: self.user_agent,
            has_request_body: request_body.is_some(),
            has_response_body: response_body.is_some(),
        };
        (
            rec,
            CallBody {
                request_body,
                response_body,
            },
        )
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteInput {
    pub exposed_model: String,
    pub base_url: String,
    pub api_key: String,
    pub real_model: String,
    pub provider: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedConfigInput {
    pub port: u16,
    pub local_key: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedStatus {
    pub running: bool,
    pub port: u16,
    pub route_count: usize,
    pub has_local_key: bool,
    pub models: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStat {
    pub model: String,
    pub count: u64,
    pub errors: u64,
    pub total_tokens: u64,
    pub avg_duration_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedStats {
    pub total: u64,
    pub success: u64,
    pub errors: u64,
    pub avg_duration_ms: u64,
    pub p95_duration_ms: u64,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
    pub by_model: Vec<ModelStat>,
}

struct ManagerInner {
    /// Handle to the running sidecar process, if any.
    child: Option<CommandChild>,
    /// True when a gateway we did not spawn (e.g. an orphan sidecar from a
    /// previous app run) is already listening on the port and we adopted it
    /// instead of spawning a duplicate.
    external: bool,
    /// Port the running sidecar is bound to.
    running_port: Option<u16>,
    /// Port to bind on the next start.
    pending_port: u16,
}

/// Tauri-managed handle for the unified gateway sidecar.
pub struct UnifiedManager {
    inner: Arc<Mutex<ManagerInner>>,
    shared: Arc<RwLock<SharedState>>,
    client: reqwest::Client,
}

impl Default for UnifiedManager {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(ManagerInner {
                child: None,
                external: false,
                running_port: None,
                pending_port: DEFAULT_PORT,
            })),
            shared: Arc::new(RwLock::new(SharedState::default())),
            client: reqwest::Client::new(),
        }
    }
}

impl UnifiedManager {
    /// Kill the sidecar we spawned, if any. Synchronous and lock-contention
    /// tolerant so it is safe to call from the app's exit handler — this is what
    /// stops a force-quit/normal exit from leaving an orphaned gateway whose
    /// stdout (and call logs) the next run can no longer capture.
    pub fn shutdown(&self) {
        if let Ok(mut inner) = self.inner.try_lock() {
            if let Some(child) = inner.child.take() {
                let _ = child.kill();
            }
            inner.external = false;
            inner.running_port = None;
        }
    }
}

/// Resolve (and create) the gateway config file path inside the app config dir.
fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法获取应用配置目录：{e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建配置目录：{e}"))?;
    Ok(dir.join("gateway-config.json"))
}

/// Resolve (and create) the directory holding per-call request/response bodies.
fn bodies_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法获取应用配置目录：{e}"))?
        .join("unified-bodies");
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建报文目录：{e}"))?;
    Ok(dir)
}

/// Atomically write the routing config the sidecar reads (temp file + rename so
/// the watcher never observes a partial write).
fn write_config_file(path: &Path, shared: &SharedState) -> Result<(), String> {
    let value = shared.to_config_json();
    let bytes =
        serde_json::to_vec_pretty(&value).map_err(|e| format!("序列化网关配置失败：{e}"))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &bytes).map_err(|e| format!("写入网关配置失败：{e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("替换网关配置失败：{e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn unified_api_set_config(
    app: tauri::AppHandle,
    manager: tauri::State<'_, UnifiedManager>,
    config: UnifiedConfigInput,
    routes: Vec<RouteInput>,
) -> Result<UnifiedStatus, String> {
    {
        let mut inner = manager.inner.lock().await;
        inner.pending_port = config.port;
    }
    {
        let mut shared = manager.shared.write().await;
        shared.local_key = config
            .local_key
            .map(|k| k.trim().to_string())
            .filter(|k| !k.is_empty());
        shared.routes = routes
            .into_iter()
            .map(|r| {
                (
                    r.exposed_model,
                    Upstream {
                        base_url: r.base_url.trim_end_matches('/').to_string(),
                        api_key: r.api_key,
                        real_model: r.real_model,
                        provider: r.provider,
                    },
                )
            })
            .collect();
    }
    // Persist the config so it is ready for the next start and so a running
    // sidecar hot-reloads it (it watches the file).
    let path = config_path(&app)?;
    {
        let shared = manager.shared.read().await;
        write_config_file(&path, &shared)?;
    }
    status(&manager).await
}

#[tauri::command]
pub async fn unified_api_start(
    app: tauri::AppHandle,
    manager: tauri::State<'_, UnifiedManager>,
) -> Result<UnifiedStatus, String> {
    let port = {
        let inner = manager.inner.lock().await;
        if inner.child.is_some() {
            drop(inner);
            return status(&manager).await;
        }
        inner.pending_port
    };

    let path = config_path(&app)?;
    {
        let shared = manager.shared.read().await;
        write_config_file(&path, &shared)?;
    }

    // A gateway may already be listening on the port — typically an orphan
    // sidecar left over from a previous app run (e.g. a crash or force-quit)
    // that still holds the port. Adopting it keeps routing working (it watches
    // the same config file), but we can no longer read that process's stdout, so
    // its structured call-log lines are lost and the monitor stays empty.
    //
    // To keep call logs reliable, reclaim the port instead: terminate the
    // orphaned sidecar and spawn a fresh one we own (so its stdout — and thus
    // the call log — is captured). Only fall back to adopting when the port
    // cannot be freed (e.g. it is held by a process we may not touch), so the
    // gateway always stays usable.
    if probe_healthy(&manager.client, port).await {
        let reclaimed = reclaim_port(&manager.client, port).await;
        if !reclaimed {
            let mut inner = manager.inner.lock().await;
            inner.external = true;
            inner.running_port = Some(port);
            drop(inner);
            return status(&manager).await;
        }
    }

    let sidecar = app
        .shell()
        .sidecar(SIDECAR_NAME)
        .map_err(|e| format!("无法创建网关 sidecar：{e}"))?;
    let (mut rx, child) = sidecar
        .args([
            format!("--port={port}"),
            format!("--config={}", path.display()),
        ])
        .spawn()
        .map_err(|e| format!("启动网关进程失败：{e}"))?;

    // Pump sidecar stdout/stderr: structured log lines feed the ring buffer and
    // the frontend event; everything else is forwarded for diagnostics.
    let shared = manager.shared.clone();
    let inner_handle = manager.inner.clone();
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    handle_stdout_line(&shared, &app_handle, line.trim_end()).await;
                }
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    let line = line.trim_end();
                    if !line.is_empty() {
                        eprintln!("[gateway] {line}");
                    }
                }
                CommandEvent::Error(err) => {
                    eprintln!("[gateway] sidecar error: {err}");
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[gateway] sidecar exited: {:?}", payload.code);
                    let mut inner = inner_handle.lock().await;
                    inner.child = None;
                    inner.external = false;
                    inner.running_port = None;
                    break;
                }
                _ => {}
            }
        }
    });

    {
        let mut inner = manager.inner.lock().await;
        inner.child = Some(child);
        inner.external = false;
        inner.running_port = Some(port);
    }

    // Best-effort health check so the UI only reports "running" once the gateway
    // is actually accepting connections.
    if let Err(e) = wait_healthy(&manager.client, port).await {
        eprintln!("[gateway] health check failed: {e}");
    }

    status(&manager).await
}

#[tauri::command]
pub async fn unified_api_stop(
    manager: tauri::State<'_, UnifiedManager>,
) -> Result<UnifiedStatus, String> {
    {
        let mut inner = manager.inner.lock().await;
        if let Some(child) = inner.child.take() {
            let _ = child.kill();
        }
        // An adopted (external) gateway is not ours to kill; just stop tracking
        // it so the UI reflects a stopped state.
        inner.external = false;
        inner.running_port = None;
    }
    status(&manager).await
}

#[tauri::command]
pub async fn unified_api_status(
    manager: tauri::State<'_, UnifiedManager>,
) -> Result<UnifiedStatus, String> {
    status(&manager).await
}

#[tauri::command]
pub async fn unified_api_logs(
    manager: tauri::State<'_, UnifiedManager>,
    limit: Option<usize>,
) -> Result<Vec<CallLogRecord>, String> {
    let shared = manager.shared.read().await;
    let limit = limit.unwrap_or(500);
    let logs: Vec<CallLogRecord> = shared.logs.iter().rev().take(limit).cloned().collect();
    Ok(logs)
}

#[tauri::command]
pub async fn unified_api_clear_logs(
    app: tauri::AppHandle,
    manager: tauri::State<'_, UnifiedManager>,
) -> Result<(), String> {
    {
        let mut shared = manager.shared.write().await;
        shared.logs.clear();
    }
    // Best-effort removal of all persisted bodies.
    if let Ok(dir) = bodies_dir(&app) {
        let _ = std::fs::remove_dir_all(&dir);
    }
    Ok(())
}

/// Load the captured request/response bodies for a single call, on demand.
#[tauri::command]
pub async fn unified_api_call_body(
    app: tauri::AppHandle,
    id: u64,
) -> Result<CallBody, String> {
    let path = bodies_dir(&app)?.join(format!("{id}.json"));
    match std::fs::read(&path) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|e| format!("解析调用报文失败：{e}"))
        }
        Err(_) => Ok(CallBody::default()),
    }
}

#[tauri::command]
pub async fn unified_api_stats(
    manager: tauri::State<'_, UnifiedManager>,
) -> Result<UnifiedStats, String> {
    let shared = manager.shared.read().await;
    Ok(compute_stats(&shared.logs))
}

/// Parse a single sidecar stdout line, recording structured call logs.
async fn handle_stdout_line(shared: &Arc<RwLock<SharedState>>, app: &tauri::AppHandle, line: &str) {
    if line.is_empty() {
        return;
    }
    let Some(rest) = line.strip_prefix(LOG_MARKER) else {
        eprintln!("[gateway] {line}");
        return;
    };
    match serde_json::from_str::<SidecarLog>(rest) {
        Ok(log) => {
            let (rec, body) = log.into_record();
            let has_body = body.request_body.is_some() || body.response_body.is_some();
            let (stored, evicted) = {
                let mut s = shared.write().await;
                s.push_log(rec)
            };
            // Persist bodies to disk (loaded lazily by the monitor UI), and drop
            // the evicted call's body file to keep the store bounded.
            if has_body || evicted.is_some() {
                if let Ok(dir) = bodies_dir(app) {
                    if has_body {
                        if let Ok(bytes) = serde_json::to_vec(&body) {
                            let _ = std::fs::write(dir.join(format!("{}.json", stored.id)), bytes);
                        }
                    }
                    if let Some(evicted_id) = evicted {
                        let _ = std::fs::remove_file(dir.join(format!("{evicted_id}.json")));
                    }
                }
            }
            let _ = app.emit(CALL_LOG_EVENT, &stored);
        }
        Err(e) => eprintln!("[gateway] 无法解析调用日志：{e}"),
    }
}

/// Best-effort reclaim of a port held by an orphaned gateway sidecar: terminate
/// the listener (only when it looks like our own sidecar) and wait until the
/// port is free. Returns `true` once nothing is answering on `/health` anymore,
/// so the caller can spawn a fresh sidecar it owns. Returns `false` if the port
/// could not be freed, in which case the caller should adopt the existing one.
async fn reclaim_port(client: &reqwest::Client, port: u16) -> bool {
    let killed = tokio::task::spawn_blocking(move || kill_gateway_on_port(port))
        .await
        .unwrap_or(false);
    if !killed {
        return false;
    }
    // Wait for the OS to actually release the port before we try to bind it.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    loop {
        if !probe_healthy(client, port).await {
            return true;
        }
        if std::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(std::time::Duration::from_millis(120)).await;
    }
}

/// Terminate any process listening on `port` that is our gateway sidecar.
/// Returns `true` if at least one matching sidecar was signalled. Other
/// processes on the port are left untouched so we never kill an unrelated
/// listener. Blocking; run via `spawn_blocking`.
#[cfg(unix)]
fn kill_gateway_on_port(port: u16) -> bool {
    use std::process::Command;
    let Ok(out) = Command::new("lsof")
        .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-t"])
        .output()
    else {
        return false;
    };
    let pids: Vec<u32> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| l.trim().parse::<u32>().ok())
        .collect();
    let mut signalled = false;
    for pid in pids {
        let comm = Command::new("ps")
            .args(["-p", &pid.to_string(), "-o", "comm="])
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default();
        if !comm.contains("portkey") {
            continue;
        }
        if Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status()
            .is_ok()
        {
            signalled = true;
        }
    }
    signalled
}

/// Windows variant of [`kill_gateway_on_port`].
#[cfg(windows)]
fn kill_gateway_on_port(port: u16) -> bool {
    use std::process::Command;
    let Ok(out) = Command::new("netstat").args(["-ano", "-p", "TCP"]).output() else {
        return false;
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let needle = format!(":{port}");
    let mut pids: Vec<u32> = text
        .lines()
        .filter(|l| l.contains("LISTENING") && l.contains(&needle))
        .filter_map(|l| {
            l.split_whitespace()
                .last()
                .and_then(|p| p.parse::<u32>().ok())
        })
        .collect();
    pids.sort_unstable();
    pids.dedup();
    let mut signalled = false;
    for pid in pids {
        let tasks = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
            .unwrap_or_default();
        if !tasks.contains("portkey") {
            continue;
        }
        if Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .status()
            .is_ok()
        {
            signalled = true;
        }
    }
    signalled
}

/// One-shot health probe: returns true if a gateway is already answering on the
/// port. Used to detect an externally-running gateway before spawning.
async fn probe_healthy(client: &reqwest::Client, port: u16) -> bool {
    let url = format!("http://127.0.0.1:{port}/health");
    matches!(
        client
            .get(&url)
            .timeout(std::time::Duration::from_millis(500))
            .send()
            .await,
        Ok(resp) if resp.status().is_success()
    )
}

/// Poll the sidecar `/health` endpoint until it responds or the timeout elapses.
async fn wait_healthy(client: &reqwest::Client, port: u16) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{port}/health");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
    loop {
        match client
            .get(&url)
            .timeout(std::time::Duration::from_millis(500))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => return Ok(()),
            _ => {
                if std::time::Instant::now() >= deadline {
                    return Err("网关在超时时间内未就绪".to_string());
                }
                tokio::time::sleep(std::time::Duration::from_millis(120)).await;
            }
        }
    }
}

async fn status(manager: &tauri::State<'_, UnifiedManager>) -> Result<UnifiedStatus, String> {
    let inner = manager.inner.lock().await;
    let shared = manager.shared.read().await;
    let mut models: Vec<String> = shared.routes.keys().cloned().collect();
    models.sort();
    Ok(UnifiedStatus {
        running: inner.child.is_some() || inner.external,
        port: inner.running_port.unwrap_or(inner.pending_port),
        route_count: shared.routes.len(),
        has_local_key: shared.local_key.is_some(),
        models,
    })
}

fn compute_stats(logs: &VecDeque<CallLogRecord>) -> UnifiedStats {
    let total = logs.len() as u64;
    let mut success = 0u64;
    let mut errors = 0u64;
    let mut durations: Vec<u128> = Vec::with_capacity(logs.len());
    let mut prompt_tokens = 0u64;
    let mut completion_tokens = 0u64;
    let mut total_tokens = 0u64;
    let mut per_model: HashMap<String, (u64, u64, u64, u128)> = HashMap::new();

    for rec in logs {
        if rec.error.is_none() && (200..400).contains(&rec.status) {
            success += 1;
        } else {
            errors += 1;
        }
        durations.push(rec.duration_ms);
        prompt_tokens += rec.prompt_tokens.unwrap_or(0);
        completion_tokens += rec.completion_tokens.unwrap_or(0);
        total_tokens += rec.total_tokens.unwrap_or(0);
        let entry = per_model
            .entry(rec.exposed_model.clone())
            .or_insert((0, 0, 0, 0));
        entry.0 += 1;
        if rec.error.is_some() || !(200..400).contains(&rec.status) {
            entry.1 += 1;
        }
        entry.2 += rec.total_tokens.unwrap_or(0);
        entry.3 += rec.duration_ms;
    }

    let avg_duration_ms = if durations.is_empty() {
        0
    } else {
        (durations.iter().sum::<u128>() / durations.len() as u128) as u64
    };
    let p95_duration_ms = percentile(&mut durations, 95.0);

    let mut by_model: Vec<ModelStat> = per_model
        .into_iter()
        .map(|(model, (count, errs, toks, dur))| ModelStat {
            model,
            count,
            errors: errs,
            total_tokens: toks,
            avg_duration_ms: if count == 0 {
                0
            } else {
                (dur / count as u128) as u64
            },
        })
        .collect();
    by_model.sort_by_key(|b| std::cmp::Reverse(b.count));

    UnifiedStats {
        total,
        success,
        errors,
        avg_duration_ms,
        p95_duration_ms,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        by_model,
    }
}

fn percentile(durations: &mut [u128], pct: f64) -> u64 {
    if durations.is_empty() {
        return 0;
    }
    durations.sort_unstable();
    let rank = ((pct / 100.0) * (durations.len() as f64 - 1.0)).round() as usize;
    durations[rank.min(durations.len() - 1)] as u64
}
