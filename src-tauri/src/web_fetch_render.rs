//! Render-mode page fetch backed by the native webview.
//!
//! Some channels (zhihu, xiaohongshu, the wechat ecosystem) are JS-rendered or
//! login-walled, so a headless HTTP GET returns a login wall instead of content.
//! Render mode loads the URL in an offscreen native child webview that shares
//! the app's cookie jar (hence the user's real login session), waits for the
//! page to settle, then has an injected script POST the rendered
//! `documentElement.outerHTML` back to the localhost preview server's sink. The
//! Rust side polls the sink, parses the HTML with the same extractor as HTTP
//! mode, and tears the webview down.
//!
//! The whole flow is time-boxed; on any failure the caller falls back to
//! headless HTTP so the agent never hangs.

use std::time::Duration;

use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl};

use crate::preview::PreviewState;
use crate::web_fetch::{normalize_url, parse_html, WebFetchRequest, WebFetchResponse};

const MAIN_WINDOW: &str = "main";
const DEFAULT_RENDER_TIMEOUT_MS: u64 = 25_000;
const MAX_RENDER_TIMEOUT_MS: u64 = 60_000;
const POLL_INTERVAL_MS: u64 = 150;
const DEFAULT_MAX_CHARS: usize = 40_000;

/// Build the init script that posts the rendered HTML back to the sink once the
/// page has settled. `port`/`token` address the preview server's POST endpoint.
fn snapshot_script(port: u16, token: &str) -> String {
    format!(
        r#"(function() {{
  var sent = false;
  function send() {{
    if (sent) return;
    sent = true;
    try {{
      var html = document.documentElement ? document.documentElement.outerHTML : '';
      fetch('http://127.0.0.1:{port}/__webfetch/{token}', {{
        method: 'POST',
        body: html,
      }}).catch(function() {{}});
    }} catch (e) {{}}
  }}
  // Post a short while after load so client-rendered content can appear.
  if (document.readyState === 'complete') {{
    setTimeout(send, 1200);
  }} else {{
    window.addEventListener('load', function() {{ setTimeout(send, 1200); }});
  }}
  // Hard fallback in case the load event never fires.
  setTimeout(send, 4000);
}})();"#
    )
}

pub async fn fetch_render(
    app: &AppHandle,
    req: &WebFetchRequest,
) -> Result<WebFetchResponse, String> {
    let url = normalize_url(&req.url)?;
    let timeout_ms = req
        .timeout_ms
        .unwrap_or(DEFAULT_RENDER_TIMEOUT_MS)
        .min(MAX_RENDER_TIMEOUT_MS);
    let max_chars = req.max_chars.unwrap_or(DEFAULT_MAX_CHARS).max(500);

    let port = app
        .state::<PreviewState>()
        .port()
        .ok_or_else(|| "preview server not started".to_string())?;

    let token = format!(
        "wf{:x}{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0),
        url.as_str().len()
    );
    let label = format!("web-fetch-worker-{token}");

    // Drain any stale snapshot for this token.
    let _ = crate::preview::take_sink(&token);

    // Create the offscreen worker webview on the main thread.
    let app_create = app.clone();
    let label_create = label.clone();
    let url_create = url.clone();
    let script = snapshot_script(port, &token);
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    app.run_on_main_thread(move || {
        let result = (|| {
            let window = app_create
                .get_window(MAIN_WINDOW)
                .ok_or_else(|| "main window not found".to_string())?;
            let builder = tauri::webview::WebviewBuilder::new(
                &label_create,
                WebviewUrl::External(url_create),
            )
            .initialization_script(&script);
            window
                .add_child(
                    builder,
                    // Park the worker offscreen so it never paints over the UI.
                    LogicalPosition::new(-6000.0, -6000.0),
                    LogicalSize::new(1280.0, 900.0),
                )
                .map_err(|e| e.to_string())?;
            Ok(())
        })();
        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;
    rx.recv()
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("worker webview creation failed: {e}"))?;

    // Poll the sink until the snapshot arrives or we time out.
    let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms);
    let mut snapshot: Option<String> = None;
    while std::time::Instant::now() < deadline {
        if let Some(body) = crate::preview::take_sink(&token) {
            snapshot = Some(body);
            break;
        }
        tokio::time::sleep(Duration::from_millis(POLL_INTERVAL_MS)).await;
    }

    // Tear the worker webview down regardless of outcome.
    let app_close = app.clone();
    let label_close = label.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(wv) = app_close.get_webview(&label_close) {
            let _ = wv.close();
        }
    });

    let html = snapshot.ok_or_else(|| "render timed out before snapshot".to_string())?;
    Ok(parse_html(&req.url, &url, 200, &html, max_chars, "render"))
}
