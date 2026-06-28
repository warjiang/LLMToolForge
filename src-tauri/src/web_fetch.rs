//! Headless web page fetcher for the ResearchAgent's agent-native collection.
//!
//! `web_fetch` performs an HTTP GET with a browser-like User-Agent, follows
//! redirects, and converts the returned HTML into readable plain text plus a
//! list of links. This is the core collection primitive that replaced the old
//! proxy/login-dependent Python scrapers: the agent searches (via MCP) to find
//! per-channel URLs, then reads them here with no proxy and no login required.
//!
//! A `render` mode (driven through the native webview, which carries the user's
//! real login session) is layered on top in a follow-up so JS-rendered /
//! login-walled channels are still reachable. HTTP mode always works as a
//! fallback so the tool never hangs.

use std::time::Duration;

use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use tauri::Url;

const DEFAULT_TIMEOUT_MS: u64 = 20_000;
const MAX_TIMEOUT_MS: u64 = 60_000;
const DEFAULT_MAX_CHARS: usize = 40_000;
const MAX_LINKS: usize = 200;
/// A modern desktop Chrome UA; many sites block the default reqwest agent.
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
     (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebFetchRequest {
    pub url: String,
    /// Reserved for the native-webview render path (login/JS pages).
    #[serde(default)]
    pub render: bool,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub max_chars: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebFetchLink {
    pub text: String,
    pub href: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebFetchResponse {
    pub url: String,
    pub final_url: String,
    pub status: u16,
    pub title: String,
    pub text: String,
    pub links: Vec<WebFetchLink>,
    pub truncated: bool,
    /// "http" or "render".
    pub mode: String,
}

pub(crate) fn normalize_url(input: &str) -> Result<Url, String> {
    let s = input.trim();
    if s.is_empty() {
        return Err("empty url".into());
    }
    let candidate = if s.contains("://") {
        s.to_string()
    } else {
        format!("https://{s}")
    };
    Url::parse(&candidate).map_err(|e| format!("invalid url {s}: {e}"))
}

/// Tags whose subtree carries no readable content.
fn is_skipped_tag(name: &str) -> bool {
    matches!(
        name,
        "script" | "style" | "noscript" | "template" | "svg" | "head" | "iframe" | "canvas"
    )
}

/// Block-level tags that should force a line break for readability.
fn is_block_tag(name: &str) -> bool {
    matches!(
        name,
        "p" | "div"
            | "section"
            | "article"
            | "header"
            | "footer"
            | "li"
            | "ul"
            | "ol"
            | "tr"
            | "table"
            | "br"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "blockquote"
            | "pre"
    )
}

/// Recursively collect readable text from the DOM, skipping non-content
/// subtrees and inserting line breaks at block boundaries.
fn collect_text(node: ego_tree::NodeRef<scraper::Node>, out: &mut String) {
    match node.value() {
        scraper::Node::Text(t) => {
            let chunk = t.text.replace(['\u{00a0}'], " ");
            let trimmed = chunk.trim_matches(|c: char| c == '\n' || c == '\r');
            if !trimmed.trim().is_empty() {
                if !out.ends_with(['\n', ' ']) && !out.is_empty() {
                    out.push(' ');
                }
                // Collapse internal runs of whitespace.
                let mut last_ws = false;
                for ch in trimmed.chars() {
                    if ch.is_whitespace() {
                        if !last_ws {
                            out.push(' ');
                            last_ws = true;
                        }
                    } else {
                        out.push(ch);
                        last_ws = false;
                    }
                }
            }
        }
        scraper::Node::Element(el) => {
            let name = el.name();
            if is_skipped_tag(name) {
                return;
            }
            let block = is_block_tag(name);
            if block && !out.ends_with('\n') && !out.is_empty() {
                out.push('\n');
            }
            for child in node.children() {
                collect_text(child, out);
            }
            if block && !out.ends_with('\n') {
                out.push('\n');
            }
        }
        _ => {
            for child in node.children() {
                collect_text(child, out);
            }
        }
    }
}

/// Collapse 3+ consecutive newlines into 2 and trim trailing space per line.
fn tidy_text(raw: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    let mut blank_run = 0;
    for line in raw.lines() {
        let trimmed = line.trim_end().to_string();
        if trimmed.trim().is_empty() {
            blank_run += 1;
            if blank_run <= 1 {
                lines.push(String::new());
            }
        } else {
            blank_run = 0;
            lines.push(trimmed);
        }
    }
    lines.join("\n").trim().to_string()
}

fn extract_title(doc: &Html) -> String {
    Selector::parse("title")
        .ok()
        .and_then(|sel| doc.select(&sel).next())
        .map(|el| el.text().collect::<String>().trim().to_string())
        .unwrap_or_default()
}

fn extract_links(doc: &Html, base: &Url) -> Vec<WebFetchLink> {
    let sel = match Selector::parse("a[href]") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let mut seen = std::collections::HashSet::new();
    let mut links = Vec::new();
    for el in doc.select(&sel) {
        if links.len() >= MAX_LINKS {
            break;
        }
        let Some(href) = el.value().attr("href") else {
            continue;
        };
        let href = href.trim();
        if href.is_empty() || href.starts_with('#') || href.starts_with("javascript:") {
            continue;
        }
        let Ok(abs) = base.join(href) else {
            continue;
        };
        let abs_s = abs.to_string();
        if !seen.insert(abs_s.clone()) {
            continue;
        }
        let text = el.text().collect::<String>();
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        links.push(WebFetchLink {
            text: text.chars().take(160).collect(),
            href: abs_s,
        });
    }
    links
}

/// Parse raw HTML into a `WebFetchResponse` body (title/text/links).
pub(crate) fn parse_html(
    requested: &str,
    final_url: &Url,
    status: u16,
    html: &str,
    max_chars: usize,
    mode: &str,
) -> WebFetchResponse {
    let doc = Html::parse_document(html);
    let title = extract_title(&doc);
    let links = extract_links(&doc, final_url);

    let mut text = String::new();
    let body_sel = Selector::parse("body").ok();
    if let Some(body) = body_sel.and_then(|sel| doc.select(&sel).next()) {
        collect_text(*body, &mut text);
    } else {
        collect_text(doc.tree.root(), &mut text);
    }
    let mut text = tidy_text(&text);
    let mut truncated = false;
    if text.chars().count() > max_chars {
        text = text.chars().take(max_chars).collect();
        truncated = true;
    }

    WebFetchResponse {
        url: requested.to_string(),
        final_url: final_url.to_string(),
        status,
        title,
        text,
        links,
        truncated,
        mode: mode.to_string(),
    }
}

async fn fetch_http(req: &WebFetchRequest) -> Result<WebFetchResponse, String> {
    let url = normalize_url(&req.url)?;
    let timeout = req
        .timeout_ms
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .min(MAX_TIMEOUT_MS);
    let max_chars = req.max_chars.unwrap_or(DEFAULT_MAX_CHARS).max(500);

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_millis(timeout))
        .build()
        .map_err(|e| format!("http client error: {e}"))?;

    let resp = client
        .get(url.clone())
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let status = resp.status().as_u16();
    let final_url = resp.url().clone();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("read body failed: {e}"))?;

    Ok(parse_html(
        &req.url, &final_url, status, &body, max_chars, "http",
    ))
}

/// Fetch a URL and return its readable text + links. `render` mode is handled
/// by the native-webview path; everything else uses headless HTTP.
#[tauri::command]
pub async fn web_fetch(
    app: tauri::AppHandle,
    req: WebFetchRequest,
) -> Result<WebFetchResponse, String> {
    if req.render {
        match crate::web_fetch_render::fetch_render(&app, &req).await {
            Ok(res) => return Ok(res),
            Err(e) => {
                // Never hang the agent: fall back to headless HTTP.
                eprintln!("web_fetch render failed, falling back to http: {e}");
            }
        }
    }
    fetch_http(&req).await
}
