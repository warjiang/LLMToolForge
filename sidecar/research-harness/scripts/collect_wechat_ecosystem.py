#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent
for path in (SCRIPT_DIR, ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from collection_guard import write_collection_output
from research_harness.approval import KeywordApprovalError, require_keyword_approval


SCENARIO_ID = "todo-extraction"
CHANNEL_ID = "wechat-ecosystem"

DEFAULT_KEYWORDS = [
    "微信待办",
    "微信群待办",
    "微信群日报",
    "群消息太多",
    "聊天记录总结",
    "微信 AI 总结",
    "客户微信跟进",
    "微信聊天记录 导出",
    "微信读取聊天记录",
    "微信封号",
    "聊记",
    "龙虾 微信",
    "腾讯元宝 微信总结",
]
SOGOU_WEIXIN_BASE = "https://weixin.sogou.com/weixin"
DEFAULT_WECHAT_SEARCH_TEMPLATE = (
    "https://search.weixin.qq.com/cgi-bin/newsearchweb/userclientjump"
    "?path=page/search/weread&query={query}&platform=pc"
)
PRIVATE_USE_RE = re.compile(r"[\ue000-\uf8ff]")
LI_RE = re.compile(r"<li\b[^>]*>.*?</li>", re.I | re.S)
TITLE_LINK_RE = re.compile(
    r"<h3\b[^>]*>.*?<a\b[^>]*href=(?P<quote>['\"])(?P<href>.*?)(?P=quote)[^>]*>"
    r"(?P<title>.*?)</a>.*?</h3>",
    re.I | re.S,
)
ANCHOR_RE = re.compile(
    r"<a\b[^>]*href=(?P<quote>['\"])(?P<href>.*?)(?P=quote)[^>]*>(?P<text>.*?)</a>",
    re.I | re.S,
)


def _load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def load_channel_plan() -> dict[str, Any]:
    root = Path(__file__).resolve().parents[1]
    return _load_json(root / "channels" / "wechat-ecosystem.json").get("crawl_plan") or {}


def load_default_keywords() -> list[str]:
    root = Path(__file__).resolve().parents[1]
    channel = _load_json(root / "channels" / "wechat-ecosystem.json")
    matrix = _load_json(root / "keyword_matrices" / "todo-extraction.json")
    keywords = channel.get("crawl_plan", {}).get("keywords") or matrix.get("channel_keywords", {}).get("wechat-ecosystem") or []
    return [str(keyword) for keyword in keywords] or list(DEFAULT_KEYWORDS)


def build_opener(proxy: str) -> urllib.request.OpenerDirector:
    if not proxy:
        return urllib.request.build_opener()
    return urllib.request.build_opener(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))


def read_text(opener: urllib.request.OpenerDirector, url: str, timeout_seconds: float) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) research-harness/0.1",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.6",
            "Referer": "https://weixin.sogou.com/",
        },
    )
    with opener.open(request, timeout=timeout_seconds) as response:
        raw = response.read()
        charset = response.headers.get_content_charset() or "utf-8"
    return raw.decode(charset, errors="replace")


def clean_text(value: object) -> str:
    text = html.unescape(str(value or ""))
    text = PRIVATE_USE_RE.sub("", text)
    text = text.replace("<!--red_beg-->", "").replace("<!--red_end-->", "")
    text = re.sub(r"<script\b[^>]*>.*?</script>", " ", text, flags=re.I | re.S)
    text = re.sub(r"<style\b[^>]*>.*?</style>", " ", text, flags=re.I | re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    text = urllib.parse.unquote(text)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" -_|\n\t\r")


def _hash_id(value: str, length: int = 16) -> str:
    return hashlib.sha1(value.encode("utf-8", errors="ignore")).hexdigest()[:length]


def _normalize_url(href: str, base_url: str = "https://weixin.sogou.com/") -> str:
    url = html.unescape(href or "").strip()
    if not url:
        return ""
    if url.startswith("//"):
        url = "https:" + url
    elif url.startswith("/"):
        url = urllib.parse.urljoin(base_url, url)
    parsed = urllib.parse.urlparse(url)
    query = urllib.parse.parse_qs(parsed.query)
    if "url" in query and query["url"]:
        candidate = query["url"][0]
        if candidate.startswith("http"):
            return candidate
    return url


def _first_match(pattern: str, segment: str) -> str:
    match = re.search(pattern, segment, re.I | re.S)
    return clean_text(match.group(1)) if match else ""


def _class_text(segment: str, tag: str, class_name: str) -> str:
    pattern = rf"<{tag}\b(?P<attrs>[^>]*)>(?P<body>.*?)</{tag}>"
    for match in re.finditer(pattern, segment, re.I | re.S):
        attrs = match.group("attrs")
        class_match = re.search(r"class=(['\"])(.*?)\1", attrs, re.I | re.S)
        if not class_match:
            continue
        classes = class_match.group(2).split()
        if class_name in classes:
            return clean_text(match.group("body"))
    return ""


def _snippet_from_segment(segment: str) -> str:
    for pattern in [
        r"<p\b[^>]*class=(['\"])[^'\"]*txt-info[^'\"]*\1[^>]*>(.*?)</p>",
        r"<p\b[^>]*class=(['\"])[^'\"]*txt[^'\"]*\1[^>]*>(.*?)</p>",
        r"<div\b[^>]*class=(['\"])[^'\"]*txt-box[^'\"]*\1[^>]*>(.*?)</div>",
    ]:
        match = re.search(pattern, segment, re.I | re.S)
        if match:
            text = clean_text(match.group(2))
            if text:
                return text
    return ""


def _account_from_segment(segment: str) -> str:
    return _class_text(segment, "span", "all-time-y2") or _class_text(segment, "a", "account")


def _date_from_segment(segment: str) -> str:
    timestamp = re.search(r"timeConvert\(['\"](\d{10})['\"]\)", segment, re.I)
    if timestamp:
        return datetime.fromtimestamp(int(timestamp.group(1)), timezone.utc).date().isoformat()
    for text in [_class_text(segment, "span", "s2"), _class_text(segment, "span", "time")]:
        if text:
            return text
    return ""


def _title_link_from_segment(segment: str) -> tuple[str, str]:
    match = TITLE_LINK_RE.search(segment)
    if match:
        return clean_text(match.group("title")), _normalize_url(match.group("href"))
    for match in ANCHOR_RE.finditer(segment):
        href = _normalize_url(match.group("href"))
        title = clean_text(match.group("text"))
        if href and title and ("mp.weixin.qq.com" in href or "weixin.sogou.com" in href):
            return title, href
    return "", ""


def _record_type_from_text(text: str) -> str:
    lowered = text.lower()
    if any(term.lower() in lowered for term in ["聊记", "龙虾", "腾讯元宝", "元宝", "小程序", "插件", "工具", "助手"]):
        return "competitor"
    if any(term in text for term in ["视频号", "直播", "短视频"]):
        return "weak_signal"
    return "article"


def parse_sogou_results(page_html: str, query: str, search_url: str, max_results: int) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    seen: set[str] = set()
    for segment_match in LI_RE.finditer(page_html):
        if len(records) >= max_results:
            break
        segment = segment_match.group(0)
        title, url = _title_link_from_segment(segment)
        if not title or not url or url in seen:
            continue
        seen.add(url)
        body = _snippet_from_segment(segment) or title
        account = _account_from_segment(segment)
        indexed_date = _date_from_segment(segment)
        rank = len(records) + 1
        text_for_type = " ".join([query, title, body, account])
        records.append(
            {
                "source_id": f"sogou-weixin:{_hash_id(url)}",
                "title": title,
                "source_url": url,
                "record_type": _record_type_from_text(text_for_type),
                "query": query,
                "body": body,
                "comments": [],
                "metrics": {
                    "search_rank": rank,
                    "indexed_date": indexed_date,
                    "account_name": account,
                    "captured_surface": "sogou_weixin",
                    "source_type": "official_account_search",
                },
                "extra": {
                    "search_url": search_url,
                    "search_result_only": True,
                    "detail_fetch_status": "not_attempted",
                },
            }
        )
    return records


def _article_title(page_html: str) -> str:
    for pattern in [
        r"<h1\b[^>]*id=(['\"])activity-name\1[^>]*>(.*?)</h1>",
        r"<h1\b[^>]*class=(['\"])[^'\"]*rich_media_title[^'\"]*\1[^>]*>(.*?)</h1>",
        r"<title\b[^>]*>(.*?)</title>",
    ]:
        match = re.search(pattern, page_html, re.I | re.S)
        if match:
            text = clean_text(match.group(2) if len(match.groups()) > 1 else match.group(1))
            if text:
                return text.replace("_微信", "").strip()
    return ""


def _article_account(page_html: str) -> str:
    for pattern in [
        r"<a\b[^>]*id=(['\"])js_name\1[^>]*>(.*?)</a>",
        r"<strong\b[^>]*class=(['\"])[^'\"]*profile_nickname[^'\"]*\1[^>]*>(.*?)</strong>",
    ]:
        match = re.search(pattern, page_html, re.I | re.S)
        if match:
            text = clean_text(match.group(2))
            if text:
                return text
    return ""


def _article_publish_time(page_html: str) -> str:
    for pattern in [
        r"var\s+ct\s*=\s*['\"](\d{10})['\"]",
        r"publish_time\s*[:=]\s*['\"]([^'\"]+)['\"]",
        r"<em\b[^>]*id=(['\"])publish_time\1[^>]*>(.*?)</em>",
    ]:
        match = re.search(pattern, page_html, re.I | re.S)
        if not match:
            continue
        value = match.group(2) if len(match.groups()) > 1 else match.group(1)
        value = clean_text(value)
        if value.isdigit() and len(value) == 10:
            return datetime.fromtimestamp(int(value), timezone.utc).date().isoformat()
        if value:
            return value
    return ""


def _article_body(page_html: str) -> str:
    match = re.search(r"<div\b[^>]*id=(['\"])js_content\1[^>]*>(.*?)</div>\s*</div>", page_html, re.I | re.S)
    if not match:
        match = re.search(r"<div\b[^>]*id=(['\"])js_content\1[^>]*>(.*?)</div>", page_html, re.I | re.S)
    if not match:
        return ""
    body = clean_text(match.group(2))
    return body[:4000]


def parse_wechat_article_detail(page_html: str) -> dict[str, str]:
    return {
        "title": _article_title(page_html),
        "account_name": _article_account(page_html),
        "publish_time": _article_publish_time(page_html),
        "body": _article_body(page_html),
    }


def enrich_article_details(
    opener: urllib.request.OpenerDirector,
    records: list[dict[str, Any]],
    max_article_details: int,
    pause_seconds: float,
    timeout_seconds: float,
) -> list[dict[str, Any]]:
    if max_article_details <= 0:
        return records
    attempted = 0
    for record in records:
        if attempted >= max_article_details:
            break
        if record.get("record_type") not in {"article", "competitor"}:
            continue
        url = str(record.get("source_url") or "")
        if not url or "mp.weixin.qq.com" not in url:
            continue
        attempted += 1
        try:
            page = read_text(opener, url, timeout_seconds)
            detail = parse_wechat_article_detail(page)
        except Exception as exc:
            record.setdefault("extra", {})["detail_fetch_status"] = f"failed: {exc}"
            continue
        if len(detail.get("body", "")) >= 40:
            record["title"] = detail.get("title") or record.get("title", "")
            record["body"] = detail["body"]
            metrics = dict(record.get("metrics") or {})
            if detail.get("account_name"):
                metrics["account_name"] = detail["account_name"]
            if detail.get("publish_time"):
                metrics["publish_time"] = detail["publish_time"]
            record["metrics"] = metrics
            record.setdefault("extra", {})["search_result_only"] = False
            record.setdefault("extra", {})["detail_fetch_status"] = "fetched"
        else:
            record.setdefault("extra", {})["detail_fetch_status"] = "no_article_body"
        time.sleep(pause_seconds)
    return records


def sogou_search(
    opener: urllib.request.OpenerDirector,
    keyword: str,
    max_results: int,
    pause_seconds: float,
    timeout_seconds: float,
) -> tuple[str, list[dict[str, Any]]]:
    params = {
        "type": "2",
        "query": keyword,
        "ie": "utf8",
    }
    url = SOGOU_WEIXIN_BASE + "?" + urllib.parse.urlencode(params)
    page = read_text(opener, url, timeout_seconds)
    time.sleep(pause_seconds)
    return url, parse_sogou_results(page, keyword, url, max_results)


def collect_sogou_weixin(
    opener: urllib.request.OpenerDirector,
    keywords: list[str],
    max_results_per_keyword: int,
    max_total_records: int,
    max_article_details: int,
    pause_seconds: float,
    timeout_seconds: float,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, str]]]:
    records: list[dict[str, Any]] = []
    probes: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    seen: set[str] = set()
    for keyword in keywords:
        if len(records) >= max_total_records:
            break
        try:
            search_url, found = sogou_search(opener, keyword, max_results_per_keyword, pause_seconds, timeout_seconds)
        except Exception as exc:
            errors.append({"surface": "sogou_weixin", "query": keyword, "error": str(exc)})
            print(f"sogou weixin search failed for {keyword}: {exc}", file=sys.stderr)
            continue
        probes.append({"surface": "sogou_weixin", "query": keyword, "search_url": search_url, "result_count": len(found)})
        for record in found:
            key = str(record.get("source_url") or record.get("source_id"))
            if not key or key in seen:
                continue
            seen.add(key)
            records.append(record)
            if len(records) >= max_total_records:
                break
    detail_budget = min(max_article_details, max(0, max_total_records))
    records = enrich_article_details(opener, records, detail_budget, pause_seconds, timeout_seconds)
    return records, probes, errors


def _safe_filename(value: str) -> str:
    text = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff._-]+", "-", value).strip("-")
    return text[:60] or _hash_id(value, 8)


def run_browser_harness_probe(
    query: str,
    url_template: str,
    max_results: int,
    screenshots_dir: Path,
    timeout_seconds: float,
) -> dict[str, Any]:
    binary = shutil.which("browser-harness")
    if not binary:
        return {"query": query, "error": "browser-harness not found on PATH"}
    encoded_query = urllib.parse.quote(query)
    url = url_template.format(query=encoded_query, raw_query=query)
    screenshots_dir.mkdir(parents=True, exist_ok=True)
    screenshot_path = screenshots_dir / f"wechat-ecosystem-{_safe_filename(query)}.png"
    js_extract = r"""
(() => {
  const anchors = Array.from(document.querySelectorAll('a'));
  const rows = [];
  for (const [idx, anchor] of anchors.entries()) {
    const box = anchor.closest('li, article, section, div') || anchor;
    const title = (anchor.innerText || '').replace(/\s+/g, ' ').trim();
    const text = (box.innerText || title).replace(/\s+/g, ' ').trim();
    const href = anchor.href || '';
    if (!title && !text) continue;
    rows.push({rank: idx + 1, title: title.slice(0, 160), text: text.slice(0, 700), href});
  }
  return rows.slice(0, 80);
})()
"""
    script = f"""
import json
result = {{"query": {json.dumps(query, ensure_ascii=False)}, "url": {json.dumps(url)}, "items": []}}
try:
    new_tab({json.dumps(url)})
    wait_for_load(20)
    wait(2)
    result["page_info"] = page_info()
    result["visible_text"] = js("document.body ? document.body.innerText.slice(0, 3000) : ''") or ""
    result["screenshot_path"] = capture_screenshot({json.dumps(str(screenshot_path))}, full=True)
    result["items"] = js({json.dumps(js_extract)}) or []
except Exception as exc:
    result["error"] = str(exc)
print(json.dumps(result, ensure_ascii=False))
"""
    try:
        completed = subprocess.run(
            [binary, "-c", script],
            text=True,
            capture_output=True,
            timeout=timeout_seconds,
            check=False,
        )
    except Exception as exc:
        return {"query": query, "url": url, "error": str(exc)}
    probe = {
        "query": query,
        "url": url,
        "returncode": completed.returncode,
        "stderr": completed.stderr.strip()[-1000:],
    }
    stdout_lines = [line for line in completed.stdout.splitlines() if line.strip()]
    for line in reversed(stdout_lines):
        try:
            payload = json.loads(line)
            probe.update(payload)
            break
        except json.JSONDecodeError:
            continue
    if "items" not in probe:
        probe["items"] = []
        probe["error"] = probe.get("error") or "browser-harness produced no JSON payload"
        probe["stdout_tail"] = completed.stdout.strip()[-1000:]
    probe["items"] = list(probe.get("items") or [])[:max_results]
    return probe


def _browser_item_record(query: str, item: dict[str, Any], page_url: str, screenshot_path: str, idx: int) -> dict[str, Any] | None:
    title = clean_text(item.get("title")) or clean_text(str(item.get("text") or "")[:80])
    body = clean_text(item.get("text"))
    url = str(item.get("href") or "").strip() or page_url
    if not title or not url:
        return None
    text_for_type = " ".join([query, title, body])
    rank = int(item.get("rank") or idx)
    return {
        "source_id": f"wechat-search:{_hash_id(query + ':' + url + ':' + str(rank), 16)}",
        "title": title,
        "source_url": url,
        "record_type": _record_type_from_text(text_for_type),
        "query": query,
        "body": body or title,
        "comments": [],
        "metrics": {
            "search_rank": rank,
            "captured_surface": "wechat_search",
            "source_type": "wechat_search_result",
            "screenshot_path": screenshot_path,
        },
        "extra": {
            "search_url": page_url,
            "search_result_only": True,
            "browser_harness": True,
        },
    }


def collect_browser_wechat_search(
    keywords: list[str],
    url_template: str,
    max_results_per_keyword: int,
    max_total_records: int,
    screenshots_dir: Path,
    timeout_seconds: float,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, str]]]:
    records: list[dict[str, Any]] = []
    probes: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    seen: set[str] = set()
    for keyword in keywords:
        if len(records) >= max_total_records:
            break
        probe = run_browser_harness_probe(keyword, url_template, max_results_per_keyword, screenshots_dir, timeout_seconds)
        visible_text = str(probe.get("visible_text") or "")
        login_wall = any(term in visible_text for term in ["登录", "扫码", "验证", "安全校验"])
        probes.append(
            {
                "surface": "wechat_search",
                "query": keyword,
                "url": probe.get("url", ""),
                "page_info": probe.get("page_info", {}),
                "screenshot_path": probe.get("screenshot_path", ""),
                "result_count": len(probe.get("items") or []),
                "login_or_verification_wall": login_wall,
                "error": probe.get("error", ""),
            }
        )
        if probe.get("error"):
            errors.append({"surface": "wechat_search", "query": keyword, "error": str(probe.get("error"))})
            continue
        for idx, item in enumerate(probe.get("items") or [], start=1):
            record = _browser_item_record(
                keyword,
                item,
                str(probe.get("url") or ""),
                str(probe.get("screenshot_path") or ""),
                idx,
            )
            if not record:
                continue
            key = str(record.get("source_url") or record.get("source_id"))
            if key in seen:
                continue
            seen.add(key)
            records.append(record)
            if len(records) >= max_total_records:
                break
    return records, probes, errors


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect WeChat ecosystem evidence via Sogou Weixin and browser-harness.")
    parser.add_argument("--output", required=True, help="Output JSON path.")
    parser.add_argument("--keyword", action="append", default=[], help="Search keyword. Repeatable.")
    parser.add_argument("--max-results-per-keyword", type=int, default=20)
    parser.add_argument("--max-total-records", type=int, default=120)
    parser.add_argument("--max-article-details", type=int, default=20)
    parser.add_argument("--pause-seconds", type=float, default=0.35)
    parser.add_argument("--timeout-seconds", type=float, default=12)
    parser.add_argument("--browser-timeout-seconds", type=float, default=45)
    parser.add_argument("--proxy", default="", help="HTTP proxy, empty to disable.")
    parser.add_argument("--screenshots-dir", default="/private/tmp", help="Directory for browser screenshots.")
    parser.add_argument("--skip-browser", action="store_true", help="Skip browser-harness WeChat search probes.")
    parser.add_argument("--skip-sogou", action="store_true", help="Skip Sogou Weixin indexed article search.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    channel_plan = load_channel_plan()
    keywords = args.keyword or load_default_keywords()
    try:
        require_keyword_approval(
            ROOT,
            SCENARIO_ID,
            CHANNEL_ID,
            operation="collect WeChat ecosystem evidence",
            keywords=keywords,
        )
    except KeywordApprovalError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    generated_at = datetime.now(timezone.utc).isoformat()
    records: list[dict[str, Any]] = []
    probes: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    seen: set[str] = set()

    if not args.skip_sogou:
        opener = build_opener(args.proxy)
        sogou_records, sogou_probes, sogou_errors = collect_sogou_weixin(
            opener=opener,
            keywords=keywords,
            max_results_per_keyword=args.max_results_per_keyword,
            max_total_records=args.max_total_records,
            max_article_details=args.max_article_details,
            pause_seconds=args.pause_seconds,
            timeout_seconds=args.timeout_seconds,
        )
        probes.extend(sogou_probes)
        errors.extend(sogou_errors)
        for record in sogou_records:
            key = str(record.get("source_url") or record.get("source_id"))
            if key and key not in seen:
                seen.add(key)
                records.append(record)

    if not args.skip_browser and len(records) < args.max_total_records:
        browser_records, browser_probes, browser_errors = collect_browser_wechat_search(
            keywords=keywords,
            url_template=str(channel_plan.get("browser_search_url_template") or DEFAULT_WECHAT_SEARCH_TEMPLATE),
            max_results_per_keyword=args.max_results_per_keyword,
            max_total_records=args.max_total_records - len(records),
            screenshots_dir=Path(args.screenshots_dir),
            timeout_seconds=args.browser_timeout_seconds,
        )
        probes.extend(browser_probes)
        errors.extend(browser_errors)
        for record in browser_records:
            key = str(record.get("source_url") or record.get("source_id"))
            if key and key not in seen:
                seen.add(key)
                records.append(record)

    envelope = {
        "generatedAt": generated_at,
        "source": {
            "sogou_weixin": SOGOU_WEIXIN_BASE,
            "wechat_search_template": str(channel_plan.get("browser_search_url_template") or DEFAULT_WECHAT_SEARCH_TEMPLATE),
        },
        "meta": {
            "keywords": keywords,
            "max_results_per_keyword": args.max_results_per_keyword,
            "max_total_records": args.max_total_records,
            "max_article_details": args.max_article_details,
            "browser_enabled": not args.skip_browser,
            "sogou_enabled": not args.skip_sogou,
            "records_are_search_snippets": True,
            "probes": probes,
            "errors": errors,
            "collection_note": "Only public search results and public official-account pages are collected; private chats, private groups, and unauthorized comments are excluded.",
        },
        "records": records[: args.max_total_records],
    }
    output = Path(args.output)
    print(f"Wrote {len(envelope['records'])} WeChat ecosystem records to {output}")
    if errors:
        print(f"Completed with {len(errors)} collection errors", file=sys.stderr)
    return write_collection_output(output, envelope, channel="wechat-ecosystem", fail_on_errors=True, fail_on_login_wall=True)


if __name__ == "__main__":
    raise SystemExit(main())
