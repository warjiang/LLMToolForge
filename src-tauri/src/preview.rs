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
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
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
    let range_header = head.lines().find_map(|line| {
        line.split_once(':').and_then(|(name, value)| {
            if name.trim().eq_ignore_ascii_case("range") {
                Some(value.trim().to_string())
            } else {
                None
            }
        })
    });

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

    let resp = route(&raw_path, &state, range_header.as_deref());
    let mut header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {len}\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-cache\r\nConnection: close\r\n",
        status = resp.status,
        ctype = resp.ctype,
        len = resp.content_length
    );
    for (name, value) in resp.extra_headers {
        header.push_str(name);
        header.push_str(": ");
        header.push_str(&value);
        header.push_str("\r\n");
    }
    header.push_str("\r\n");
    stream.write_all(header.as_bytes()).await?;
    match resp.body {
        PreviewBody::Bytes(bytes) => {
            stream.write_all(&bytes).await?;
        }
        PreviewBody::FileRange {
            path,
            start,
            length,
        } => {
            if length > 0 {
                let mut file = File::open(path).await?;
                file.seek(std::io::SeekFrom::Start(start)).await?;
                let mut remain = length;
                let mut chunk = [0u8; 8192];
                while remain > 0 {
                    let want = chunk.len().min(remain as usize);
                    let n = file.read(&mut chunk[..want]).await?;
                    if n == 0 {
                        break;
                    }
                    stream.write_all(&chunk[..n]).await?;
                    remain = remain.saturating_sub(n as u64);
                }
            }
        }
    }
    stream.flush().await?;
    Ok(())
}

enum PreviewBody {
    Bytes(Vec<u8>),
    FileRange {
        path: PathBuf,
        start: u64,
        length: u64,
    },
}

struct PreviewHttpResponse {
    status: &'static str,
    ctype: &'static str,
    content_length: u64,
    body: PreviewBody,
    extra_headers: Vec<(&'static str, String)>,
}

fn route(
    raw_path: &str,
    state: &Arc<Mutex<PreviewInner>>,
    range: Option<&str>,
) -> PreviewHttpResponse {
    let no_hash = raw_path.split('#').next().unwrap_or("/");
    let (path, query) = no_hash.split_once('?').unwrap_or((no_hash, ""));
    let path = path.trim_start_matches('/');

    if path == "_vendor/echarts.min.js" {
        return PreviewHttpResponse {
            status: "200 OK",
            ctype: "application/javascript; charset=utf-8",
            content_length: ECHARTS_JS.len() as u64,
            body: PreviewBody::Bytes(ECHARTS_JS.to_vec()),
            extra_headers: Vec::new(),
        };
    }

    let (token, rest) = match path.split_once('/') {
        Some((token, rest)) => (token, rest),
        None => (path, ""),
    };
    if token.is_empty() {
        return not_found();
    }

    let dir = {
        let inner = state.lock().unwrap();
        match inner.mounts.get(token) {
            Some(dir) => dir.clone(),
            None => return not_found(),
        }
    };

    // HTML wrapper for non-HTML artifacts (image/video/audio/pdf).
    if rest == "__view" {
        let Some((file, kind)) = parse_view_query(query) else {
            return not_found();
        };
        let Some(_canon) = resolve_mounted_file(&dir, &file) else {
            return not_found();
        };
        if !matches!(kind.as_str(), "image" | "video" | "audio" | "pdf") {
            return not_found();
        }
        let encoded_path = percent_encode_path(&file);
        let escaped_name = html_escape(&file);
        let media_src = format!("/{token}/{encoded_path}");
        let body = build_viewer_html(&media_src, &kind, &escaped_name).into_bytes();
        return PreviewHttpResponse {
            status: "200 OK",
            ctype: "text/html; charset=utf-8",
            content_length: body.len() as u64,
            body: PreviewBody::Bytes(body),
            extra_headers: Vec::new(),
        };
    }

    let rest = if rest.is_empty() { "index.html" } else { rest };
    let Some(canon) = resolve_mounted_file(&dir, rest) else {
        return not_found();
    };
    let file_len = match canon.metadata() {
        Ok(m) => m.len(),
        Err(_) => return not_found(),
    };
    let mut extra_headers = vec![("Accept-Ranges", "bytes".to_string())];
    match apply_range(range, file_len as usize) {
        Ok(Some((start, end))) => {
            extra_headers.push(("Content-Range", format!("bytes {start}-{end}/{file_len}")));
            PreviewHttpResponse {
                status: "206 Partial Content",
                ctype: content_type(&canon),
                content_length: (end - start + 1) as u64,
                body: PreviewBody::FileRange {
                    path: canon,
                    start: start as u64,
                    length: (end - start + 1) as u64,
                },
                extra_headers,
            }
        }
        Ok(None) => PreviewHttpResponse {
            status: "200 OK",
            ctype: content_type(&canon),
            content_length: file_len,
            body: PreviewBody::FileRange {
                path: canon,
                start: 0,
                length: file_len,
            },
            extra_headers,
        },
        Err(()) => PreviewHttpResponse {
            status: "416 Range Not Satisfiable",
            ctype: "text/plain; charset=utf-8",
            content_length: 21,
            body: PreviewBody::Bytes(b"Range Not Satisfiable".to_vec()),
            extra_headers,
        },
    }
}

fn parse_view_query(query: &str) -> Option<(String, String)> {
    let mut file = None;
    let mut kind = None;
    for pair in query.split('&') {
        let (raw_key, raw_value) = pair.split_once('=').unwrap_or((pair, ""));
        let key = percent_decode(raw_key)?;
        let value = percent_decode(raw_value)?;
        if key == "f" {
            file = Some(value);
        } else if key == "kind" {
            kind = Some(value);
        }
    }
    Some((file?, kind?))
}

fn resolve_mounted_file(dir: &Path, rel: &str) -> Option<PathBuf> {
    if rel.contains("..") {
        return None;
    }
    let candidate = dir.join(rel);
    let canon = candidate.canonicalize().ok()?;
    if !canon.starts_with(dir) || !canon.is_file() {
        return None;
    }
    Some(canon)
}

fn apply_range(range: Option<&str>, len: usize) -> Result<Option<(usize, usize)>, ()> {
    let Some(range_header) = range else {
        return Ok(None);
    };
    let Some((start, end)) = parse_range(range_header, len)? else {
        return Ok(None);
    };
    Ok(Some((start, end)))
}

fn parse_range(range_header: &str, len: usize) -> Result<Option<(usize, usize)>, ()> {
    if !range_header.starts_with("bytes=") {
        return Ok(None);
    }
    if len == 0 {
        return Err(());
    }
    let spec = range_header
        .trim_start_matches("bytes=")
        .split(',')
        .next()
        .unwrap_or("");
    let (start_raw, end_raw) = spec.split_once('-').ok_or(())?;
    if start_raw.is_empty() {
        let suffix = end_raw.parse::<usize>().map_err(|_| ())?;
        if suffix == 0 {
            return Err(());
        }
        let start = len.saturating_sub(suffix);
        return Ok(Some((start, len - 1)));
    }
    let start = start_raw.parse::<usize>().map_err(|_| ())?;
    if start >= len {
        return Err(());
    }
    let end = if end_raw.is_empty() {
        len - 1
    } else {
        let parsed = end_raw.parse::<usize>().map_err(|_| ())?;
        parsed.min(len - 1)
    };
    if end < start {
        return Err(());
    }
    Ok(Some((start, end)))
}

fn percent_decode(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return None;
            }
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
            let val = u8::from_str_radix(hex, 16).ok()?;
            out.push(val);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).ok()
}

fn percent_encode_path(input: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut out = String::with_capacity(input.len());
    for b in input.as_bytes() {
        let safe = b.is_ascii_alphanumeric() || matches!(*b, b'-' | b'_' | b'.' | b'~' | b'/');
        if safe {
            out.push(char::from(*b));
        } else {
            out.push('%');
            out.push(char::from(HEX[(b >> 4) as usize]));
            out.push(char::from(HEX[(b & 0x0F) as usize]));
        }
    }
    out
}

fn html_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn build_viewer_html(src: &str, kind: &str, name: &str) -> String {
    let media = match kind {
        "image" => format!(
            r#"<img src="{src}" alt="{name}" style="max-width:100%;max-height:100%;object-fit:contain;display:block;" />"#
        ),
        "video" => format!(
            r#"<video src="{src}" controls style="max-width:100%;max-height:100%;display:block;background:#000;"></video>"#
        ),
        "audio" => {
            format!(r#"<audio src="{src}" controls style="width:min(960px,96vw);"></audio>"#)
        }
        "pdf" => format!(
            r#"<iframe src="{src}" title="{name}" style="width:100%;height:100%;border:0;background:#fff;"></iframe>"#
        ),
        _ => "<div>Unsupported preview kind</div>".to_string(),
    };
    format!(
        r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>{name}</title>
    <style>
      html,body{{height:100%;margin:0}}
      body{{background:#0b0f14;color:#e8edf2;display:flex;flex-direction:column;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}}
      header{{padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.08);font-size:12px;color:#9fb0c3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
      main{{flex:1;display:flex;align-items:center;justify-content:center;padding:16px;min-height:0}}
    </style>
  </head>
  <body>
    <header>{name}</header>
    <main>{media}</main>
  </body>
</html>"#
    )
}

fn not_found() -> PreviewHttpResponse {
    PreviewHttpResponse {
        status: "404 Not Found",
        ctype: "text/plain; charset=utf-8",
        content_length: 9,
        body: PreviewBody::Bytes(b"Not Found".to_vec()),
        extra_headers: Vec::new(),
    }
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
        "bmp" => "image/bmp",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "m4v" => "video/x-m4v",
        "mpeg" | "mpg" => "video/mpeg",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "flac" => "audio/flac",
        "pdf" => "application/pdf",
        "txt" => "text/plain; charset=utf-8",
        "md" => "text/markdown; charset=utf-8",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "csv" => "text/csv; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Seek, SeekFrom};
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

    fn read_resp_body(resp: &PreviewHttpResponse) -> Vec<u8> {
        match &resp.body {
            PreviewBody::Bytes(bytes) => bytes.clone(),
            PreviewBody::FileRange {
                path,
                start,
                length,
            } => {
                let mut file = std::fs::File::open(path).unwrap();
                file.seek(SeekFrom::Start(*start)).unwrap();
                let mut chunk = vec![0u8; *length as usize];
                file.read_exact(&mut chunk).unwrap();
                chunk
            }
        }
    }

    #[test]
    fn serves_vendor_echarts() {
        let dir = temp_dir("vendor");
        let state = state_with("tok", &dir);
        let resp = route("/_vendor/echarts.min.js", &state, None);
        assert_eq!(resp.status, "200 OK");
        assert!(resp.ctype.starts_with("application/javascript"));
        assert!(!read_resp_body(&resp).is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn serves_mounted_index_by_default() {
        let dir = temp_dir("index");
        std::fs::write(dir.join("index.html"), b"<h1>hi</h1>").unwrap();
        let state = state_with("tok", &dir);
        let resp = route("/tok/", &state, None);
        assert_eq!(resp.status, "200 OK");
        assert!(resp.ctype.starts_with("text/html"));
        assert_eq!(read_resp_body(&resp), b"<h1>hi</h1>");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn serves_nested_asset_and_strips_query() {
        let dir = temp_dir("asset");
        std::fs::write(dir.join("main.js"), b"console.log(1)").unwrap();
        let state = state_with("tok", &dir);
        let resp = route("/tok/main.js?v=2", &state, None);
        assert_eq!(resp.status, "200 OK");
        assert!(resp.ctype.starts_with("application/javascript"));
        assert_eq!(read_resp_body(&resp), b"console.log(1)");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn blocks_path_traversal() {
        let dir = temp_dir("trav");
        std::fs::write(dir.join("index.html"), b"ok").unwrap();
        let state = state_with("tok", &dir);
        let resp = route("/tok/../../etc/passwd", &state, None);
        assert_eq!(resp.status, "404 Not Found");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn unknown_token_is_404() {
        let dir = temp_dir("unknown");
        let state = state_with("tok", &dir);
        let resp = route("/nope/index.html", &state, None);
        assert_eq!(resp.status, "404 Not Found");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn serves_media_content_types() {
        assert_eq!(content_type(Path::new("a.mp4")), "video/mp4");
        assert_eq!(content_type(Path::new("a.mp3")), "audio/mpeg");
        assert_eq!(content_type(Path::new("a.pdf")), "application/pdf");
    }

    #[test]
    fn serves_partial_content_with_range() {
        let dir = temp_dir("range");
        std::fs::write(dir.join("sample.mp4"), b"0123456789").unwrap();
        let state = state_with("tok", &dir);
        let resp = route("/tok/sample.mp4", &state, Some("bytes=2-5"));
        assert_eq!(resp.status, "206 Partial Content");
        assert_eq!(read_resp_body(&resp), b"2345");
        assert!(resp
            .extra_headers
            .iter()
            .any(|(k, v)| *k == "Content-Range" && v == "bytes 2-5/10"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn serves_viewer_page() {
        let dir = temp_dir("viewer");
        std::fs::write(dir.join("clip.mp4"), b"video").unwrap();
        let state = state_with("tok", &dir);
        let resp = route("/tok/__view?f=clip.mp4&kind=video", &state, None);
        assert_eq!(resp.status, "200 OK");
        assert!(resp.ctype.starts_with("text/html"));
        let html = String::from_utf8(read_resp_body(&resp)).unwrap();
        assert!(html.contains("<video"));
        assert!(html.contains("/tok/clip.mp4"));
        let _ = std::fs::remove_dir_all(dir);
    }
}
