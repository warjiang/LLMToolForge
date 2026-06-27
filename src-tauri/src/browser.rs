//! In-app browser backed by a native child webview embedded in the main window.
//!
//! The webview lifecycle, navigation and history are owned here on the Rust side
//! because the JS `Webview` class cannot navigate / read the URL / go back or
//! forward. The frontend drives everything through the `browser_*` commands and
//! listens to `browser://navigated` / `browser://loading` events.
//!
//! Embedding multiple webviews in a single window relies on Tauri's `unstable`
//! feature (`Window::add_child`).

use std::sync::Mutex;

use serde::Serialize;
use tauri::webview::{PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, Url, WebviewUrl};

/// Label of the embedded browser webview.
const BROWSER_LABEL: &str = "browser-preview";
/// Label of the main application window.
const MAIN_WINDOW: &str = "main";

const EVENT_NAVIGATED: &str = "browser://navigated";
const EVENT_LOADING: &str = "browser://loading";

/// Managed navigation history for the embedded browser.
pub struct BrowserState(pub Mutex<BrowserInner>);

pub struct BrowserInner {
    history: Vec<String>,
    /// Index into `history` of the current entry, or -1 when empty.
    index: i64,
    /// When set, the next `on_navigation` is a back/forward jump and must not
    /// mutate the history stack.
    suppress_push: bool,
}

impl Default for BrowserState {
    fn default() -> Self {
        BrowserState(Mutex::new(BrowserInner {
            history: Vec::new(),
            index: -1,
            suppress_push: false,
        }))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStatus {
    exists: bool,
    url: Option<String>,
    can_go_back: bool,
    can_go_forward: bool,
}

fn err_to_string<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Accepts a bare host (`example.com`, `localhost:5173`) or a full URL and
/// returns a parsed absolute URL, defaulting to `https://` when no scheme.
fn normalize_url(input: &str) -> Result<Url, String> {
    let s = input.trim();
    if s.is_empty() {
        return Err("empty url".into());
    }
    let candidate = if s.contains("://") {
        s.to_string()
    } else {
        format!("https://{s}")
    };
    Url::parse(&candidate).map_err(err_to_string)
}

/// Records a navigation in the history stack and notifies the frontend.
fn handle_navigation(app: &AppHandle, url: &Url) {
    let state = app.state::<BrowserState>();
    let url_s = url.to_string();

    let (current, can_back, can_fwd) = {
        let mut inner = state.0.lock().unwrap();
        if inner.suppress_push {
            // Back/forward jump: index was already updated by the command.
            inner.suppress_push = false;
        } else if inner.index >= 0 && inner.history.get(inner.index as usize) == Some(&url_s) {
            // Same URL (initial load / reload): keep the stack as-is.
        } else {
            let keep = (inner.index + 1).max(0) as usize;
            inner.history.truncate(keep);
            inner.history.push(url_s.clone());
            inner.index = inner.history.len() as i64 - 1;
        }

        let current = if inner.index >= 0 {
            inner
                .history
                .get(inner.index as usize)
                .cloned()
                .unwrap_or_else(|| url_s.clone())
        } else {
            url_s.clone()
        };
        let can_back = inner.index > 0;
        let can_fwd = inner.index >= 0 && (inner.index as usize) + 1 < inner.history.len();
        (current, can_back, can_fwd)
    };

    let _ = app.emit(
        EVENT_NAVIGATED,
        serde_json::json!({
            "url": current,
            "canGoBack": can_back,
            "canGoForward": can_fwd,
        }),
    );
}

/// Creates the embedded webview (first call) or navigates the existing one,
/// then positions and shows it.
#[tauri::command]
pub fn browser_open(
    app: AppHandle,
    state: State<BrowserState>,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let parsed = normalize_url(&url)?;

    if let Some(webview) = app.get_webview(BROWSER_LABEL) {
        webview
            .set_position(LogicalPosition::new(x, y))
            .map_err(err_to_string)?;
        webview
            .set_size(LogicalSize::new(width, height))
            .map_err(err_to_string)?;
        webview.navigate(parsed).map_err(err_to_string)?;
        webview.show().map_err(err_to_string)?;
        return Ok(());
    }

    // Seed history with the initial URL so back/forward work even if the very
    // first load does not fire `on_navigation`.
    {
        let mut inner = state.0.lock().unwrap();
        inner.history = vec![parsed.to_string()];
        inner.index = 0;
        inner.suppress_push = false;
    }

    let window = app
        .get_window(MAIN_WINDOW)
        .ok_or_else(|| "main window not found".to_string())?;

    let app_nav = app.clone();
    let app_load = app.clone();
    let builder = WebviewBuilder::new(BROWSER_LABEL, WebviewUrl::External(parsed))
        .on_navigation(move |u| {
            handle_navigation(&app_nav, u);
            true
        })
        .on_page_load(move |_webview, payload| {
            let loading = matches!(payload.event(), PageLoadEvent::Started);
            let _ = app_load.emit(EVENT_LOADING, serde_json::json!({ "loading": loading }));
        });

    window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(err_to_string)?;

    Ok(())
}

#[tauri::command]
pub fn browser_navigate(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = normalize_url(&url)?;
    let webview = app
        .get_webview(BROWSER_LABEL)
        .ok_or_else(|| "browser webview not open".to_string())?;
    webview.navigate(parsed).map_err(err_to_string)
}

#[tauri::command]
pub fn browser_back(app: AppHandle, state: State<BrowserState>) -> Result<(), String> {
    let target = {
        let mut inner = state.0.lock().unwrap();
        if inner.index <= 0 {
            return Ok(());
        }
        inner.index -= 1;
        inner.suppress_push = true;
        inner.history[inner.index as usize].clone()
    };
    let webview = app
        .get_webview(BROWSER_LABEL)
        .ok_or_else(|| "browser webview not open".to_string())?;
    let parsed = Url::parse(&target).map_err(err_to_string)?;
    webview.navigate(parsed).map_err(err_to_string)
}

#[tauri::command]
pub fn browser_forward(app: AppHandle, state: State<BrowserState>) -> Result<(), String> {
    let target = {
        let mut inner = state.0.lock().unwrap();
        if inner.index < 0 || (inner.index as usize) + 1 >= inner.history.len() {
            return Ok(());
        }
        inner.index += 1;
        inner.suppress_push = true;
        inner.history[inner.index as usize].clone()
    };
    let webview = app
        .get_webview(BROWSER_LABEL)
        .ok_or_else(|| "browser webview not open".to_string())?;
    let parsed = Url::parse(&target).map_err(err_to_string)?;
    webview.navigate(parsed).map_err(err_to_string)
}

#[tauri::command]
pub fn browser_reload(app: AppHandle) -> Result<(), String> {
    let webview = app
        .get_webview(BROWSER_LABEL)
        .ok_or_else(|| "browser webview not open".to_string())?;
    webview
        .eval("window.location.reload()")
        .map_err(err_to_string)
}

#[tauri::command]
pub fn browser_set_bounds(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(webview) = app.get_webview(BROWSER_LABEL) {
        webview
            .set_position(LogicalPosition::new(x, y))
            .map_err(err_to_string)?;
        webview
            .set_size(LogicalSize::new(width, height))
            .map_err(err_to_string)?;
    }
    Ok(())
}

#[tauri::command]
pub fn browser_show(app: AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview(BROWSER_LABEL) {
        webview.show().map_err(err_to_string)?;
    }
    Ok(())
}

#[tauri::command]
pub fn browser_hide(app: AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview(BROWSER_LABEL) {
        webview.hide().map_err(err_to_string)?;
    }
    Ok(())
}

#[tauri::command]
pub fn browser_close(app: AppHandle, state: State<BrowserState>) -> Result<(), String> {
    if let Some(webview) = app.get_webview(BROWSER_LABEL) {
        webview.close().map_err(err_to_string)?;
    }
    let mut inner = state.0.lock().unwrap();
    inner.history.clear();
    inner.index = -1;
    inner.suppress_push = false;
    Ok(())
}

#[tauri::command]
pub fn browser_status(app: AppHandle, state: State<BrowserState>) -> BrowserStatus {
    let exists = app.get_webview(BROWSER_LABEL).is_some();
    let inner = state.0.lock().unwrap();
    let url = if inner.index >= 0 {
        inner.history.get(inner.index as usize).cloned()
    } else {
        None
    };
    BrowserStatus {
        exists,
        url,
        can_go_back: inner.index > 0,
        can_go_forward: inner.index >= 0 && (inner.index as usize) + 1 < inner.history.len(),
    }
}
