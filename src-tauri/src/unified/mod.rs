//! Local unified API server.
//!
//! Exposes the user's connected models through a local OpenAI-compatible and
//! Anthropic-compatible HTTP server so external tools (Codex, Claude Code,
//! local agents) can call them. Credentials live in the frontend; the frontend
//! pushes a routing table (`exposedModel -> upstream`) via `unified_api_set_config`.

mod anthropic;
mod http;
mod openai;
mod openapi;

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::{oneshot, Mutex, RwLock};

/// Max call-log records kept in the in-memory ring buffer.
const LOG_CAPACITY: usize = 2000;

/// Event name used to push each completed call log to the frontend.
pub const CALL_LOG_EVENT: &str = "unified://call-log";

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

/// Shared state read by the HTTP handlers.
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
    pub fn push_log(&mut self, mut rec: CallLogRecord) -> CallLogRecord {
        self.seq += 1;
        rec.id = self.seq;
        if self.logs.len() >= LOG_CAPACITY {
            self.logs.pop_front();
        }
        self.logs.push_back(rec.clone());
        rec
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

struct RunningServer {
    port: u16,
    shutdown: oneshot::Sender<()>,
}

struct ManagerInner {
    running: Option<RunningServer>,
    pending_port: u16,
}

/// Tauri-managed handle for the unified server.
pub struct UnifiedManager {
    inner: Arc<Mutex<ManagerInner>>,
    shared: Arc<RwLock<SharedState>>,
    client: reqwest::Client,
}

impl Default for UnifiedManager {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(ManagerInner {
                running: None,
                pending_port: 4141,
            })),
            shared: Arc::new(RwLock::new(SharedState::default())),
            client: reqwest::Client::new(),
        }
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub async fn unified_api_set_config(
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
    status(&manager).await
}

#[tauri::command]
pub async fn unified_api_start(
    app: tauri::AppHandle,
    manager: tauri::State<'_, UnifiedManager>,
) -> Result<UnifiedStatus, String> {
    let port = {
        let inner = manager.inner.lock().await;
        if inner.running.is_some() {
            return status(&manager).await;
        }
        inner.pending_port
    };

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("无法监听 127.0.0.1:{port}：{e}"))?;

    let ctx = http::AppCtx {
        shared: manager.shared.clone(),
        client: manager.client.clone(),
        app: app.clone(),
    };
    let router = http::router(ctx);
    let (tx, rx) = oneshot::channel::<()>();

    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = rx.await;
            })
            .await;
    });

    {
        let mut inner = manager.inner.lock().await;
        inner.running = Some(RunningServer { port, shutdown: tx });
    }
    status(&manager).await
}

#[tauri::command]
pub async fn unified_api_stop(
    manager: tauri::State<'_, UnifiedManager>,
) -> Result<UnifiedStatus, String> {
    {
        let mut inner = manager.inner.lock().await;
        if let Some(server) = inner.running.take() {
            let _ = server.shutdown.send(());
        }
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
    manager: tauri::State<'_, UnifiedManager>,
) -> Result<(), String> {
    let mut shared = manager.shared.write().await;
    shared.logs.clear();
    Ok(())
}

#[tauri::command]
pub async fn unified_api_stats(
    manager: tauri::State<'_, UnifiedManager>,
) -> Result<UnifiedStats, String> {
    let shared = manager.shared.read().await;
    Ok(compute_stats(&shared.logs))
}

async fn status(manager: &tauri::State<'_, UnifiedManager>) -> Result<UnifiedStatus, String> {
    let inner = manager.inner.lock().await;
    let shared = manager.shared.read().await;
    let mut models: Vec<String> = shared.routes.keys().cloned().collect();
    models.sort();
    Ok(UnifiedStatus {
        running: inner.running.is_some(),
        port: inner
            .running
            .as_ref()
            .map(|r| r.port)
            .unwrap_or(inner.pending_port),
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
