//! OpenConnector sidecar supervisor.
//!
//! OpenConnector (oomol-lab/open-connector) is an open-source connector
//! gateway that gives agents credentialed access to 1000+ third-party
//! providers (GitHub, Gmail, Notion, Slack, …). It is bundled as a compiled
//! sidecar binary (`binaries/open-connector`) plus a resource directory
//! (`resources/connector`: generated provider catalog, SQL migrations and the
//! built Web Console). This module supervises that process: it spawns/stops
//! it, health-checks it, and hands the frontend the port + admin token it
//! needs to talk to the runtime's HTTP API directly.
//!
//! Third-party credentials never enter the frontend stores: they live in the
//! runtime's own SQLite database under the app data dir
//! (`<app-data>/connector`), behind the admin-token boundary.

use std::path::PathBuf;
use std::sync::Arc;

use rand::RngCore;
use serde::Serialize;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;

/// Name of the bundled sidecar binary (see `externalBin` in `tauri.conf.json`).
const SIDECAR_NAME: &str = "open-connector";

/// Default port the connector runtime listens on until configured otherwise.
const DEFAULT_PORT: u16 = 4160;

struct ManagerInner {
    child: Option<CommandChild>,
    /// True when a runtime we did not spawn is already answering on the port
    /// and we adopted it instead of spawning a duplicate.
    external: bool,
    running_port: Option<u16>,
    pending_port: u16,
}

/// Tauri-managed handle for the OpenConnector sidecar.
pub struct ConnectorManager {
    inner: Arc<Mutex<ManagerInner>>,
    client: reqwest::Client,
}

impl Default for ConnectorManager {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(ManagerInner {
                child: None,
                external: false,
                running_port: None,
                pending_port: DEFAULT_PORT,
            })),
            client: reqwest::Client::new(),
        }
    }
}

impl ConnectorManager {
    /// Kill the sidecar we spawned, if any. Safe to call from the app's exit
    /// handler (synchronous, lock-contention tolerant).
    pub fn shutdown(&self) {
        if let Ok(mut inner) = self.inner.try_lock() {
            if let Some(child) = inner.child.take() {
                let _ = child.kill();
            }
            inner.external = false;
            inner.running_port = None;
        }
    }

    /// Status snapshot for direct (non-command) consumers such as the tray.
    pub async fn status_snapshot(
        &self,
        app: &tauri::AppHandle,
    ) -> Result<ConnectorStatus, String> {
        status(app, self).await
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorStatus {
    pub running: bool,
    pub port: u16,
    /// Bearer token for the runtime's `/api/*` admin endpoints. Only exposed
    /// to the local frontend; the runtime binds to 127.0.0.1.
    pub admin_token: String,
    /// True when we adopted an already-running runtime instead of spawning.
    pub external: bool,
}

/// Resolve the directory holding the runtime resources (catalog, migrations,
/// web console). The sidecar is started with this as its cwd.
fn resource_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .resource_dir()
        .map_err(|e| format!("无法获取资源目录：{e}"))?;
    let candidates = [
        base.join("resources").join("connector"),
        base.join("connector"),
    ];
    for c in &candidates {
        if c.join("catalog").is_dir() {
            return Ok(c.clone());
        }
    }
    Err(format!(
        "未找到 OpenConnector 资源目录（先运行 sidecar/connector 的 build.ts）。查找路径：{}",
        candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

/// Data dir for the runtime's SQLite DB and transit files.
fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录：{e}"))?
        .join("connector");
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建数据目录：{e}"))?;
    Ok(dir)
}

/// Load (or generate and persist) the admin token used to protect the
/// runtime's `/api/*` endpoints. Stable across restarts so open Console tabs
/// and copied examples keep working.
fn admin_token(app: &tauri::AppHandle) -> Result<String, String> {
    let dir = data_dir(app)?;
    let path = dir.join("admin-token");
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let token = existing.trim().to_string();
        if !token.is_empty() {
            return Ok(token);
        }
    }
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    std::fs::write(&path, &token).map_err(|e| format!("无法保存 admin token：{e}"))?;
    Ok(token)
}

async fn status(
    app: &tauri::AppHandle,
    manager: &ConnectorManager,
) -> Result<ConnectorStatus, String> {
    let token = admin_token(app)?;
    let inner = manager.inner.lock().await;
    Ok(ConnectorStatus {
        running: inner.running_port.is_some(),
        port: inner.running_port.unwrap_or(inner.pending_port),
        admin_token: token,
        external: inner.external,
    })
}

/// One-shot health probe against `/v1/health`.
async fn probe_healthy(client: &reqwest::Client, port: u16) -> bool {
    let url = format!("http://127.0.0.1:{port}/v1/health");
    matches!(
        client
            .get(&url)
            .timeout(std::time::Duration::from_millis(500))
            .send()
            .await,
        Ok(resp) if resp.status().is_success()
    )
}

/// Poll `/v1/health` until the runtime answers or the deadline passes.
async fn wait_healthy(client: &reqwest::Client, port: u16) -> Result<(), String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    loop {
        if probe_healthy(client, port).await {
            return Ok(());
        }
        if std::time::Instant::now() >= deadline {
            return Err(format!("连接器运行时未在预期时间内就绪（端口 {port}）"));
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
}

#[tauri::command]
pub async fn connector_start(
    app: tauri::AppHandle,
    manager: tauri::State<'_, ConnectorManager>,
    port: Option<u16>,
) -> Result<ConnectorStatus, String> {
    let port = {
        let mut inner = manager.inner.lock().await;
        if let Some(p) = port {
            inner.pending_port = p;
        }
        if inner.running_port.is_some() {
            drop(inner);
            return status(&app, &manager).await;
        }
        inner.pending_port
    };

    // Adopt an already-listening runtime (e.g. an orphan from a previous run
    // or a user-managed instance) instead of failing to bind the port. It uses
    // the same data dir and admin token, so the frontend keeps working.
    if probe_healthy(&manager.client, port).await {
        let mut inner = manager.inner.lock().await;
        inner.external = true;
        inner.running_port = Some(port);
        drop(inner);
        return status(&app, &manager).await;
    }

    let resources = resource_root(&app)?;
    let data = data_dir(&app)?;
    let token = admin_token(&app)?;

    let sidecar = app
        .shell()
        .sidecar(SIDECAR_NAME)
        .map_err(|e| format!("无法创建连接器 sidecar：{e}"))?
        .current_dir(&resources)
        .env("PORT", port.to_string())
        .env("HOST", "127.0.0.1")
        .env("OOMOL_CONNECT_ORIGIN", format!("http://127.0.0.1:{port}"))
        .env("OOMOL_CONNECT_DATA_DIR", data.display().to_string())
        .env(
            "OOMOL_CONNECT_MIGRATIONS_DIR",
            resources.join("migrations").display().to_string(),
        )
        .env("OOMOL_CONNECT_ADMIN_TOKEN", &token);

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("启动连接器进程失败：{e}"))?;

    let inner_handle = manager.inner.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    let line = line.trim_end();
                    if !line.is_empty() {
                        eprintln!("[connector] {line}");
                    }
                }
                CommandEvent::Error(err) => {
                    eprintln!("[connector] sidecar error: {err}");
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[connector] sidecar exited: {:?}", payload.code);
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

    if let Err(e) = wait_healthy(&manager.client, port).await {
        // Startup failed: reap state so the UI does not report a dead runtime
        // as running.
        let mut inner = manager.inner.lock().await;
        if let Some(child) = inner.child.take() {
            let _ = child.kill();
        }
        inner.external = false;
        inner.running_port = None;
        return Err(e);
    }

    status(&app, &manager).await
}

#[tauri::command]
pub async fn connector_stop(
    app: tauri::AppHandle,
    manager: tauri::State<'_, ConnectorManager>,
) -> Result<ConnectorStatus, String> {
    {
        let mut inner = manager.inner.lock().await;
        if let Some(child) = inner.child.take() {
            let _ = child.kill();
        }
        // An adopted (external) runtime is not ours to kill; just stop
        // tracking it.
        inner.external = false;
        inner.running_port = None;
    }
    status(&app, &manager).await
}

#[tauri::command]
pub async fn connector_status(
    app: tauri::AppHandle,
    manager: tauri::State<'_, ConnectorManager>,
) -> Result<ConnectorStatus, String> {
    // Reconcile with reality: if we think it's running but nothing answers
    // (e.g. a crash whose exit event we missed, or an adopted runtime that
    // went away), report stopped.
    let port = {
        let inner = manager.inner.lock().await;
        inner.running_port
    };
    if let Some(port) = port {
        if !probe_healthy(&manager.client, port).await {
            let mut inner = manager.inner.lock().await;
            if inner.child.is_none() || inner.external {
                inner.external = false;
                inner.running_port = None;
            }
        }
    }
    status(&app, &manager).await
}

/// Open a URL in the OS default browser. Used for the OAuth authorization flow
/// (the provider login must happen in a real browser so the runtime's local
/// `/oauth/callback` receives the grant) and for the runtime's Web Console.
/// Restricted to `http`/`https` URLs so it cannot be used to launch arbitrary
/// programs.
#[tauri::command]
pub async fn connector_open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("仅支持打开 http/https 链接".into());
    }
    tokio::task::spawn_blocking(move || open_url(&url))
        .await
        .map_err(|e| format!("打开链接失败：{e}"))?
}

fn open_url(url: &str) -> Result<(), String> {
    use std::process::Command;
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        c.arg(url);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.args(["/C", "start", "", url]);
        c
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut cmd = {
        let mut c = Command::new("xdg-open");
        c.arg(url);
        c
    };
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("打开浏览器失败：{e}"))
}
