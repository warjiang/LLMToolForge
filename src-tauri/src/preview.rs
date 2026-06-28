//! Lightweight static HTTP server for previewing DataAgent multi-file apps.
//!
//! The embedded browser webview (see `browser.rs`) can only navigate to real
//! URLs, so generated artifacts are served from a tiny localhost HTTP server
//! owned here. Directories are registered under opaque tokens and reachable at
//! `http://127.0.0.1:<port>/<token>/`. A bundled copy of ECharts is served at
//! `/_vendor/echarts.min.js` so generated apps stay interactive and offline.
//!
//! The server is intentionally minimal: GET only, no range requests, no
//! keep-alive. It is sufficient for serving the small HTML/JS/CSS/JSON apps the
//! DataAgent produces.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// Bundled ECharts runtime, served at `/_vendor/echarts.min.js`.
const ECHARTS_JS: &[u8] = include_bytes!("../assets/echarts.min.js");

#[derive(Default)]
pub struct PreviewInner {
    port: Option<u16>,
    mounts: HashMap<String, PathBuf>,
}

/// Tauri-managed handle to the preview server state.
#[derive(Default, Clone)]
pub struct PreviewState(pub Arc<Mutex<PreviewInner>>);

impl PreviewState {
    /// The bound localhost port, if the server has started.
    pub fn port(&self) -> Option<u16> {
        self.0.lock().unwrap().port
    }
}

/// Snapshots POSTed back by the render-mode webview, keyed by an opaque token.
static SINK: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn sink() -> &'static Mutex<HashMap<String, String>> {
    SINK.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Store a snapshot body delivered by the render-mode webview.
pub fn put_sink(token: String, body: String) {
    sink().lock().unwrap().insert(token, body);
}

/// Remove and return a previously delivered snapshot body, if present.
pub fn take_sink(token: &str) -> Option<String> {
    sink().lock().unwrap().remove(token)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRegisterRequest {
    dir: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRegisterResponse {
    url: String,
    token: String,
    port: u16,
}

/// Bind the server on an ephemeral localhost port and spawn the accept loop.
///
/// Must be called once during app setup. The bound port is recorded in the
/// managed state so `preview_register` can build URLs synchronously.
pub fn start(state: &PreviewState) -> Result<(), String> {
    let shared = state.0.clone();
    let listener =
        tauri::async_runtime::block_on(async { TcpListener::bind(("127.0.0.1", 0)).await })
            .map_err(|e| format!("预览服务绑定失败: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("预览服务地址获取失败: {e}"))?
        .port();
    state.0.lock().unwrap().port = Some(port);

    tauri::async_runtime::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let inner = shared.clone();
            tauri::async_runtime::spawn(async move {
                let _ = handle_conn(stream, inner).await;
            });
        }
    });
    Ok(())
}

/// Register a directory for previewing and return its localhost URL.
#[tauri::command]
pub fn preview_register(
    state: State<PreviewState>,
    req: PreviewRegisterRequest,
) -> Result<PreviewRegisterResponse, String> {
    let canon = PathBuf::from(&req.dir)
        .canonicalize()
        .map_err(|e| format!("预览目录无效 {}: {e}", req.dir))?;
    if !canon.is_dir() {
        return Err(format!("预览目标不是目录: {}", canon.display()));
    }

    let mut inner = state.0.lock().unwrap();
    let port = inner.port.ok_or_else(|| "预览服务未启动".to_string())?;
    // Reuse an existing token for the same directory so reloads stay stable.
    let token = inner
        .mounts
        .iter()
        .find(|(_, p)| **p == canon)
        .map(|(t, _)| t.clone())
        .unwrap_or_else(|| token_for(&canon));
    inner.mounts.insert(token.clone(), canon);

    Ok(PreviewRegisterResponse {
        url: format!("http://127.0.0.1:{port}/{token}/"),
        token,
        port,
    })
}

fn token_for(dir: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    dir.hash(&mut hasher);
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
        .hash(&mut hasher);
    format!("p{:x}", hasher.finish())
}

async fn handle_conn(
    mut stream: TcpStream,
    state: Arc<Mutex<PreviewInner>>,
) -> std::io::Result<()> {
    let mut buf = Vec::with_capacity(2048);
    let mut tmp = [0u8; 4096];
    // Read at least the headers.
    let header_end = loop {
        let n = stream.read(&mut tmp).await?;
        if n == 0 {
            break None;
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break Some(pos + 4);
        }
        if buf.len() > 1024 * 1024 {
            break Some(buf.len());
        }
    };
    let header_end = header_end.unwrap_or(buf.len());

    let head = String::from_utf8_lossy(&buf[..header_end.min(buf.len())]).to_string();
    let mut lines = head.lines();
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("GET").to_string();
    let raw_path = parts.next().unwrap_or("/").to_string();

    // POST sink: render-mode webview delivers the page snapshot here.
    if method.eq_ignore_ascii_case("POST") {
        let path = raw_path.split(['?', '#']).next().unwrap_or("/");
        if let Some(token) = path.trim_start_matches('/').strip_prefix("__webfetch/") {
            let content_length = head
                .lines()
                .find_map(|l| {
                    let l = l.to_ascii_lowercase();
                    l.strip_prefix("content-length:")
                        .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                })
                .unwrap_or(0);
            let mut body = buf[header_end.min(buf.len())..].to_vec();
            while body.len() < content_length {
                let n = stream.read(&mut tmp).await?;
                if n == 0 {
                    break;
                }
                body.extend_from_slice(&tmp[..n]);
            }
            put_sink(
                token.to_string(),
                String::from_utf8_lossy(&body).to_string(),
            );
            let resp = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\nok";
            stream.write_all(resp.as_bytes()).await?;
            stream.flush().await?;
            return Ok(());
        }
    }

    let (status, ctype, body) = route(&raw_path, &state);
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {len}\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
        len = body.len()
    );
    stream.write_all(header.as_bytes()).await?;
    stream.write_all(&body).await?;
    stream.flush().await?;
    Ok(())
}

fn route(
    raw_path: &str,
    state: &Arc<Mutex<PreviewInner>>,
) -> (&'static str, &'static str, Vec<u8>) {
    let path = raw_path.split(['?', '#']).next().unwrap_or("/");
    let path = path.trim_start_matches('/');

    if path == "_vendor/echarts.min.js" {
        return (
            "200 OK",
            "application/javascript; charset=utf-8",
            ECHARTS_JS.to_vec(),
        );
    }

    let (token, rest) = match path.split_once('/') {
        Some((token, rest)) => (token, rest),
        None => (path, ""),
    };
    if token.is_empty() {
        return not_found();
    }
    let rest = if rest.is_empty() { "index.html" } else { rest };
    if rest.contains("..") {
        return not_found();
    }

    let dir = {
        let inner = state.lock().unwrap();
        match inner.mounts.get(token) {
            Some(dir) => dir.clone(),
            None => return not_found(),
        }
    };

    let candidate = dir.join(rest);
    let canon = match candidate.canonicalize() {
        Ok(p) => p,
        Err(_) => return not_found(),
    };
    if !canon.starts_with(&dir) || !canon.is_file() {
        return not_found();
    }
    match std::fs::read(&canon) {
        Ok(bytes) => ("200 OK", content_type(&canon), bytes),
        Err(_) => not_found(),
    }
}

fn not_found() -> (&'static str, &'static str, Vec<u8>) {
    (
        "404 Not Found",
        "text/plain; charset=utf-8",
        b"Not Found".to_vec(),
    )
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "csv" => "text/csv; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(tag: &str) -> PathBuf {
        let ns = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("preview-test-{tag}-{ns}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn state_with(token: &str, dir: &Path) -> Arc<Mutex<PreviewInner>> {
        let mut inner = PreviewInner::default();
        inner
            .mounts
            .insert(token.to_string(), dir.canonicalize().unwrap());
        Arc::new(Mutex::new(inner))
    }

    #[test]
    fn serves_vendor_echarts() {
        let dir = temp_dir("vendor");
        let state = state_with("tok", &dir);
        let (status, ctype, body) = route("/_vendor/echarts.min.js", &state);
        assert_eq!(status, "200 OK");
        assert!(ctype.starts_with("application/javascript"));
        assert!(!body.is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn serves_mounted_index_by_default() {
        let dir = temp_dir("index");
        std::fs::write(dir.join("index.html"), b"<h1>hi</h1>").unwrap();
        let state = state_with("tok", &dir);
        let (status, ctype, body) = route("/tok/", &state);
        assert_eq!(status, "200 OK");
        assert!(ctype.starts_with("text/html"));
        assert_eq!(body, b"<h1>hi</h1>");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn serves_nested_asset_and_strips_query() {
        let dir = temp_dir("asset");
        std::fs::write(dir.join("main.js"), b"console.log(1)").unwrap();
        let state = state_with("tok", &dir);
        let (status, ctype, body) = route("/tok/main.js?v=2", &state);
        assert_eq!(status, "200 OK");
        assert!(ctype.starts_with("application/javascript"));
        assert_eq!(body, b"console.log(1)");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn blocks_path_traversal() {
        let dir = temp_dir("trav");
        std::fs::write(dir.join("index.html"), b"ok").unwrap();
        let state = state_with("tok", &dir);
        let (status, _, _) = route("/tok/../../etc/passwd", &state);
        assert_eq!(status, "404 Not Found");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn unknown_token_is_404() {
        let dir = temp_dir("unknown");
        let state = state_with("tok", &dir);
        let (status, _, _) = route("/nope/index.html", &state);
        assert_eq!(status, "404 Not Found");
        let _ = std::fs::remove_dir_all(dir);
    }
}
