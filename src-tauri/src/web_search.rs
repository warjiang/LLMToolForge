//! Local web search built-in.
//!
//! `web_search` scrapes a search engine's HTML results page (DuckDuckGo's
//! no-JS endpoint) with a browser-like User-Agent and parses the result
//! anchors + snippets locally. It needs no API key and no proxy, mirroring the
//! philosophy of `web_fetch`: the agent searches here to discover URLs, then
//! reads them with `web_fetch`.

use std::time::Duration;

use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use tauri::Url;

const TIMEOUT_MS: u64 = 15_000;
const DEFAULT_LIMIT: usize = 8;
const MAX_LIMIT: usize = 20;
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
     (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchRequest {
    pub query: String,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchItem {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchResponse {
    pub query: String,
    pub results: Vec<WebSearchItem>,
}

/// DuckDuckGo wraps outbound links as `/l/?uddg=<encoded target>`; unwrap them.
fn unwrap_ddg_href(href: &str) -> String {
    let raw = if href.starts_with("//") {
        format!("https:{href}")
    } else {
        href.to_string()
    };
    if let Ok(parsed) = Url::parse(&raw) {
        if parsed.path().contains("/l/") {
            if let Some((_, value)) = parsed.query_pairs().find(|(k, _)| k == "uddg") {
                return value.into_owned();
            }
        }
    }
    raw
}

fn parse_results(body: &str, limit: usize) -> Vec<WebSearchItem> {
    let doc = Html::parse_document(body);
    let result_sel = Selector::parse("div.result, div.web-result").unwrap();
    let anchor_sel = Selector::parse("a.result__a").unwrap();
    let snippet_sel = Selector::parse("a.result__snippet, .result__snippet").unwrap();

    let mut out: Vec<WebSearchItem> = Vec::new();
    for node in doc.select(&result_sel) {
        let anchor = match node.select(&anchor_sel).next() {
            Some(a) => a,
            None => continue,
        };
        let title = anchor.text().collect::<String>().trim().to_string();
        let href = anchor.value().attr("href").unwrap_or("").trim();
        if title.is_empty() || href.is_empty() {
            continue;
        }
        let url = unwrap_ddg_href(href);
        let snippet = node
            .select(&snippet_sel)
            .next()
            .map(|s| s.text().collect::<String>().trim().to_string())
            .unwrap_or_default();
        out.push(WebSearchItem { title, url, snippet });
        if out.len() >= limit {
            break;
        }
    }
    out
}

#[tauri::command]
pub async fn web_search(req: WebSearchRequest) -> Result<WebSearchResponse, String> {
    let query = req.query.trim().to_string();
    if query.is_empty() {
        return Err("empty query".into());
    }
    let limit = req.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_millis(TIMEOUT_MS))
        .build()
        .map_err(|e| format!("http client error: {e}"))?;

    let resp = client
        .get("https://html.duckduckgo.com/html/")
        .query(&[("q", query.as_str()), ("kl", "wt-wt")])
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .send()
        .await
        .map_err(|e| format!("search request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("search returned HTTP {}", resp.status().as_u16()));
    }

    let body = resp
        .text()
        .await
        .map_err(|e| format!("read search body failed: {e}"))?;

    let results = parse_results(&body, limit);
    Ok(WebSearchResponse { query, results })
}
