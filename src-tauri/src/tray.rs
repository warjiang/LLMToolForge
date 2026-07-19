//! System-tray (status-bar) integration.
//!
//! Adds a menu-bar / tray icon so the app can keep running in the background:
//! closing the main window hides it instead of quitting, and the tray icon
//! reopens it. The tray menu also lists per-model usage stats from the unified
//! API gateway, refreshed on a timer so it stays current even while hidden.

use std::sync::Mutex;

use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

use crate::connector::{
    connector_open_url, connector_start, connector_stop, ConnectorManager, ConnectorStatus,
};
use crate::unified::{UnifiedManager, UnifiedStats, UnifiedStatus};

pub const TRAY_ID: &str = "main";
const MAIN_WINDOW: &str = "main";

/// Tray-related state managed by Tauri. Holds the UI language so the native
/// menu can be localized (the frontend pushes changes via `tray_set_language`),
/// plus the signature of the menu currently applied to the tray so periodic
/// refreshes can skip rebuilding when nothing changed.
pub struct TrayState {
    language: Mutex<String>,
    menu_sig: Mutex<Option<String>>,
}

impl Default for TrayState {
    fn default() -> Self {
        Self {
            language: Mutex::new("zh".to_string()),
            menu_sig: Mutex::new(None),
        }
    }
}

impl TrayState {
    fn language(&self) -> String {
        self.language
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| "zh".to_string())
    }

    fn set_language(&self, lang: &str) {
        if let Ok(mut g) = self.language.lock() {
            *g = lang.to_string();
        }
    }

    /// True when `sig` matches the menu already applied to the tray.
    fn menu_unchanged(&self, sig: &str) -> bool {
        self.menu_sig
            .lock()
            .map(|g| g.as_deref() == Some(sig))
            .unwrap_or(false)
    }

    fn store_menu_sig(&self, sig: String) {
        if let Ok(mut g) = self.menu_sig.lock() {
            *g = Some(sig);
        }
    }
}

struct Labels {
    show: &'static str,
    sidecar_running: &'static str,
    sidecar_stopped: &'static str,
    start: &'static str,
    stop: &'static str,
    connector_running: &'static str,
    connector_stopped: &'static str,
    connector_web: &'static str,
    connector_copy_key: &'static str,
    usage_title: &'static str,
    no_calls: &'static str,
    quit: &'static str,
    calls_unit: &'static str,
    port: &'static str,
}

fn labels(lang: &str) -> Labels {
    if lang.starts_with("en") {
        Labels {
            show: "Show Window",
            sidecar_running: "Unified API: Running",
            sidecar_stopped: "Unified API: Stopped",
            start: "Start Service",
            stop: "Stop Service",
            connector_running: "OpenConnector: Running",
            connector_stopped: "OpenConnector: Stopped",
            connector_web: "Open Web Console",
            connector_copy_key: "Copy Access Key",
            usage_title: "Usage",
            no_calls: "No calls yet",
            quit: "Quit",
            calls_unit: "calls",
            port: "port",
        }
    } else {
        Labels {
            show: "显示主窗口",
            sidecar_running: "统一 API：运行中",
            sidecar_stopped: "统一 API：已停止",
            start: "启动服务",
            stop: "停止服务",
            connector_running: "OpenConnector：运行中",
            connector_stopped: "OpenConnector：已停止",
            connector_web: "打开 Web 控制台",
            connector_copy_key: "复制访问秘钥",
            usage_title: "用量统计",
            no_calls: "暂无调用",
            quit: "退出",
            calls_unit: "次",
            port: "端口",
        }
    }
}

/// Format a token count compactly (e.g. 12.3k / 1.2M).
fn fmt_tokens(n: u64) -> String {
    if n >= 1_000_000 {
        format!("{:.1}M", n as f64 / 1_000_000.0)
    } else if n >= 1_000 {
        format!("{:.1}k", n as f64 / 1_000.0)
    } else {
        n.to_string()
    }
}

/// Build the full tray menu for the given statuses + stats + language.
fn build_menu(
    app: &AppHandle,
    status: &UnifiedStatus,
    connector: Option<&ConnectorStatus>,
    stats: &UnifiedStats,
    lang: &str,
) -> tauri::Result<Menu<tauri::Wry>> {
    let l = labels(lang);
    let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> = Vec::new();

    items.push(Box::new(MenuItem::with_id(
        app,
        "show",
        l.show,
        true,
        None::<&str>,
    )?));
    items.push(Box::new(PredefinedMenuItem::separator(app)?));

    // Unified API gateway status + quick action.
    let status_text = if status.running {
        format!("{} · {} {}", l.sidecar_running, l.port, status.port)
    } else {
        l.sidecar_stopped.to_string()
    };
    items.push(Box::new(MenuItem::with_id(
        app,
        "sidecar_status",
        status_text,
        false,
        None::<&str>,
    )?));
    items.push(Box::new(MenuItem::with_id(
        app,
        if status.running {
            "sidecar_stop"
        } else {
            "sidecar_start"
        },
        if status.running { l.stop } else { l.start },
        true,
        None::<&str>,
    )?));
    items.push(Box::new(PredefinedMenuItem::separator(app)?));

    // OpenConnector runtime status + quick actions (web console, copy key).
    let conn_running = connector.map(|c| c.running).unwrap_or(false);
    let conn_text = match connector {
        Some(c) if c.running => format!("{} · {} {}", l.connector_running, l.port, c.port),
        _ => l.connector_stopped.to_string(),
    };
    items.push(Box::new(MenuItem::with_id(
        app,
        "connector_status",
        conn_text,
        false,
        None::<&str>,
    )?));
    items.push(Box::new(MenuItem::with_id(
        app,
        if conn_running {
            "connector_stop"
        } else {
            "connector_start"
        },
        if conn_running { l.stop } else { l.start },
        true,
        None::<&str>,
    )?));
    items.push(Box::new(MenuItem::with_id(
        app,
        "connector_web",
        l.connector_web,
        conn_running,
        None::<&str>,
    )?));
    items.push(Box::new(MenuItem::with_id(
        app,
        "connector_copy_key",
        l.connector_copy_key,
        conn_running,
        None::<&str>,
    )?));
    items.push(Box::new(PredefinedMenuItem::separator(app)?));

    // Usage header (disabled, purely informational).
    items.push(Box::new(MenuItem::with_id(
        app,
        "usage_title",
        l.usage_title,
        false,
        None::<&str>,
    )?));

    if stats.by_model.is_empty() {
        items.push(Box::new(MenuItem::with_id(
            app,
            "usage_empty",
            l.no_calls,
            false,
            None::<&str>,
        )?));
    } else {
        for (i, m) in stats.by_model.iter().enumerate() {
            let text = format!(
                "{}   {} {} · {} tok",
                m.model,
                m.count,
                l.calls_unit,
                fmt_tokens(m.total_tokens)
            );
            items.push(Box::new(MenuItem::with_id(
                app,
                format!("usage_{i}"),
                text,
                false,
                None::<&str>,
            )?));
        }
    }

    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(MenuItem::with_id(
        app,
        "quit",
        l.quit,
        true,
        None::<&str>,
    )?));

    let refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        items.iter().map(|b| b.as_ref()).collect();
    Menu::with_items(app, &refs)
}

/// Show and focus the main window (used by tray click and the "show" item).
fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW) {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// Start/stop the unified gateway sidecar from the tray, then refresh the menu.
fn toggle_sidecar(app: &AppHandle, start: bool) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let manager = app.state::<UnifiedManager>();
        let result = if start {
            crate::unified::unified_api_start(app.clone(), manager).await
        } else {
            crate::unified::unified_api_stop(manager).await
        };
        if let Err(e) = result {
            eprintln!(
                "[tray] sidecar {} failed: {e}",
                if start { "start" } else { "stop" }
            );
        }
        refresh(&app).await;
    });
}

/// Start/stop the OpenConnector runtime from the tray, then refresh the menu.
fn toggle_connector(app: &AppHandle, start: bool) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let manager = app.state::<ConnectorManager>();
        let result = if start {
            connector_start(app.clone(), manager, None).await
        } else {
            connector_stop(app.clone(), manager).await
        };
        if let Err(e) = result {
            eprintln!(
                "[tray] connector {} failed: {e}",
                if start { "start" } else { "stop" }
            );
        }
        refresh(&app).await;
    });
}

/// Open the OpenConnector Web Console in the system browser.
fn open_connector_web(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let manager = app.state::<ConnectorManager>();
        match manager.status_snapshot(&app).await {
            Ok(st) if st.running => {
                let url = format!("http://127.0.0.1:{}", st.port);
                if let Err(e) = connector_open_url(url).await {
                    eprintln!("[tray] open web console failed: {e}");
                }
            }
            _ => eprintln!("[tray] connector not running; cannot open console"),
        }
    });
}

/// Copy the OpenConnector admin/access key to the system clipboard.
fn copy_connector_key(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let manager = app.state::<ConnectorManager>();
        let token = match manager.status_snapshot(&app).await {
            Ok(st) => st.admin_token,
            Err(e) => {
                eprintln!("[tray] copy key failed: {e}");
                return;
            }
        };
        let _ = tokio::task::spawn_blocking(move || {
            if let Err(e) = arboard::Clipboard::new().and_then(|mut c| c.set_text(token)) {
                eprintln!("[tray] clipboard write failed: {e}");
            }
        })
        .await;
    });
}

/// Create the tray icon with its initial (empty) menu.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let lang = app.state::<TrayState>().language();
    let empty_status = UnifiedStatus {
        running: false,
        port: 0,
        route_count: 0,
        has_local_key: false,
        models: Vec::new(),
    };
    let empty = UnifiedStats::default();
    let menu = build_menu(app, &empty_status, None, &empty, &lang)?;
    let icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .tooltip("LLMToolForge")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            "sidecar_start" => toggle_sidecar(app, true),
            "sidecar_stop" => toggle_sidecar(app, false),
            "connector_start" => toggle_connector(app, true),
            "connector_stop" => toggle_connector(app, false),
            "connector_web" => open_connector_web(app),
            "connector_copy_key" => copy_connector_key(app),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

/// A compact signature of everything `build_menu` renders. When it is unchanged
/// between refreshes we skip `set_menu`, because replacing the tray menu while
/// it is open makes macOS dismiss the popup the user is reading.
fn menu_signature(
    status: &UnifiedStatus,
    connector: Option<&ConnectorStatus>,
    stats: &UnifiedStats,
    lang: &str,
) -> String {
    use std::fmt::Write;
    let mut s = String::new();
    let _ = write!(s, "{lang}|api:{}:{}|", status.running, status.port);
    match connector {
        Some(c) => {
            let _ = write!(s, "conn:{}:{}|", c.running, c.port);
        }
        None => s.push_str("conn:none|"),
    }
    for m in &stats.by_model {
        let _ = write!(s, "{}={}={};", m.model, m.count, m.total_tokens);
    }
    s
}

/// Recompute statuses + usage stats and rebuild the tray menu on the main thread.
pub async fn refresh(app: &AppHandle) {
    let unified = app.state::<UnifiedManager>();
    let status = unified.status_snapshot().await;
    let stats = unified.stats().await;
    let connector = app
        .state::<ConnectorManager>()
        .status_snapshot(app)
        .await
        .ok();
    let lang = app.state::<TrayState>().language();

    // Only rebuild when the rendered content actually changed. This keeps an
    // open tray popup from being torn down every refresh tick (the reported
    // "menu disappears after a moment" bug).
    let sig = menu_signature(&status, connector.as_ref(), &stats, &lang);
    if app.state::<TrayState>().menu_unchanged(&sig) {
        return;
    }

    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            if let Ok(menu) = build_menu(&app, &status, connector.as_ref(), &stats, &lang) {
                if tray.set_menu(Some(menu)).is_ok() {
                    app.state::<TrayState>().store_menu_sig(sig);
                }
            }
        }
    });
}

/// Frontend-invoked: sync the current UI language and refresh the tray menu.
#[tauri::command]
pub async fn tray_set_language(app: AppHandle, language: String) -> Result<(), String> {
    app.state::<TrayState>().set_language(&language);
    refresh(&app).await;
    Ok(())
}
