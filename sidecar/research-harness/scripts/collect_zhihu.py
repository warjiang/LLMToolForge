#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
from html.parser import HTMLParser
import json
import re
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
CHANNEL_ID = "zhihu"

DEFAULT_KEYWORDS = [
    "微信待办",
    "微信群待办",
    "微信群消息太多",
    "重要消息被淹没",
    "待办老忘",
    "漏回消息",
    "微信办公",
    "客户微信跟进",
    "会议纪要整理",
    "有没有待办工具",
    "信息过载",
]
SOGOU_SEARCH_URL = "https://www.sogou.com/web"
ZHihu_URL_RE = re.compile(r"https://(?:www|zhuanlan)\.zhihu\.com/[^\s\"'<>]+")
SOGOU_DATA_RE = re.compile(
    r'data-url="(?P<url>https://(?:www|zhuanlan)\.zhihu\.com/[^"]+)"'
    r'[^>]*data-rank="(?P<rank>\d+)"'
    r'[^>]*data-title="(?P<title>[^"]*)"',
    re.S,
)
PRIVATE_USE_RE = re.compile(r"[\ue000-\uf8ff]")


class SnippetParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._capture_depth = 0
        self._buffer: list[str] = []
        self.snippets: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = {key: value or "" for key, value in attrs}
        classes = set(attr.get("class", "").split())
        if tag in {"div", "p"} and {"space-txt", "star-wiki", "text-lightgray"} & classes:
            self._capture_depth = 1
            self._buffer = []
        elif self._capture_depth:
            self._capture_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if not self._capture_depth:
            return
        self._capture_depth -= 1
        if self._capture_depth == 0:
            text = clean_text("".join(self._buffer))
            if text:
                self.snippets.append(text)

    def handle_data(self, data: str) -> None:
        if self._capture_depth:
            self._buffer.append(data)


def _load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def load_channel_plan() -> dict[str, Any]:
    root = Path(__file__).resolve().parents[1]
    return _load_json(root / "channels" / "zhihu.json").get("crawl_plan") or {}


def load_default_keywords() -> list[str]:
    root = Path(__file__).resolve().parents[1]
    channel = _load_json(root / "channels" / "zhihu.json")
    matrix = _load_json(root / "keyword_matrices" / "todo-extraction.json")
    keywords = channel.get("crawl_plan", {}).get("keywords") or matrix.get("channel_keywords", {}).get("zhihu") or []
    return [str(keyword) for keyword in keywords] or list(DEFAULT_KEYWORDS)


def build_opener(proxy: str) -> urllib.request.OpenerDirector:
    if not proxy:
        return urllib.request.build_opener()
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({"http": proxy, "https": proxy})
    )


def read_text(opener: urllib.request.OpenerDirector, url: str, timeout_seconds: float) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) research-harness/0.1",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.6",
        },
    )
    with opener.open(request, timeout=timeout_seconds) as response:
        raw = response.read()
        charset = response.headers.get_content_charset() or "utf-8"
    return raw.decode(charset, errors="replace")


def clean_text(value: object) -> str:
    text = html.unescape(str(value or ""))
    text = urllib.parse.unquote(text)
    text = PRIVATE_USE_RE.sub("", text)
    text = text.replace("<!--red_beg-->", "").replace("<!--red_end-->", "")
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    text = text.replace("_知乎", "").replace(" - 知乎", "").strip(" -_")
    return text.strip()


def _snippet_from_segment(segment: str) -> str:
    parser = SnippetParser()
    parser.feed(segment)
    useful = [
        snippet
        for snippet in parser.snippets
        if snippet and not snippet.endswith("次浏览") and "个回答" not in snippet
    ]
    snippets = useful or parser.snippets
    if not snippets:
        return ""
    return max(snippets, key=len)


def _date_from_segment(segment: str) -> str:
    match = re.search(r'<span class="cite-date">([^<]+)</span>', segment)
    return clean_text(match.group(1)) if match else ""


def _source_id(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.netloc == "zhuanlan.zhihu.com":
        match = re.search(r"/p/(\d+)", parsed.path)
        return f"article:{match.group(1)}" if match else parsed.path.strip("/")
    match = re.search(r"/question/(\d+)(?:/answer/(\d+))?", parsed.path)
    if match and match.group(2):
        return f"question:{match.group(1)}:answer:{match.group(2)}"
    if match:
        return f"question:{match.group(1)}"
    return parsed.path.strip("/") or url


def _record_type(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.netloc == "zhuanlan.zhihu.com" or "/p/" in parsed.path:
        return "article"
    if "/answer/" in parsed.path:
        return "answer"
    if "/question/" in parsed.path:
        return "question"
    return "post"


def parse_sogou_results(page_html: str, query: str, search_url: str, max_results: int) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    seen: set[str] = set()
    for match in SOGOU_DATA_RE.finditer(page_html):
        if len(records) >= max_results:
            break
        url = html.unescape(match.group("url")).strip()
        if url in seen:
            continue
        seen.add(url)
        start = page_html.rfind('<div class="vrwrap"', 0, match.start())
        if start < 0:
            start = page_html.rfind("<div class='vrwrap'", 0, match.start())
        segment = page_html[start:match.start()] if start >= 0 else ""
        title = clean_text(match.group("title"))
        body = _snippet_from_segment(segment)
        if not body or body == title:
            body = title
        records.append(
            {
                "source_id": _source_id(url),
                "title": title,
                "source_url": url,
                "record_type": _record_type(url),
                "query": query,
                "body": body,
                "comments": [],
                "metrics": {
                    "search_rank": int(match.group("rank")),
                    "indexed_date": _date_from_segment(segment),
                    "search_engine": "sogou",
                },
                "extra": {
                    "search_url": search_url,
                    "search_result_only": True,
                    "detail_fetch_status": "not_attempted",
                },
            }
        )
    return records


def sogou_search(
    opener: urllib.request.OpenerDirector,
    keyword: str,
    site_query: str,
    max_results: int,
    pause_seconds: float,
    timeout_seconds: float,
) -> tuple[str, list[dict[str, Any]]]:
    query = f"{site_query} {keyword}".strip()
    params = {
        "query": query,
        "ie": "utf8",
    }
    url = SOGOU_SEARCH_URL + "?" + urllib.parse.urlencode(params)
    page = read_text(opener, url, timeout_seconds)
    time.sleep(pause_seconds)
    return url, parse_sogou_results(page, keyword, url, max_results)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect Zhihu evidence through Sogou indexed search results.")
    parser.add_argument("--output", required=True, help="Output JSON path.")
    parser.add_argument("--keyword", action="append", default=[], help="Search keyword. Repeatable.")
    parser.add_argument("--site-query", default="site:zhihu.com", help="Search prefix used in Sogou.")
    parser.add_argument("--search-top-n", type=int, default=8)
    parser.add_argument("--max-total-records", type=int, default=50)
    parser.add_argument("--pause-seconds", type=float, default=0.3)
    parser.add_argument("--timeout-seconds", type=float, default=12)
    parser.add_argument("--proxy", default="", help="HTTP proxy, empty to disable.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    keywords = args.keyword or load_default_keywords()
    try:
        require_keyword_approval(
            ROOT,
            SCENARIO_ID,
            CHANNEL_ID,
            operation="collect Zhihu evidence",
            keywords=keywords,
        )
    except KeywordApprovalError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    opener = build_opener(args.proxy)
    generated_at = datetime.now(timezone.utc).isoformat()
    records: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    seen: set[str] = set()

    for keyword in keywords:
        if len(records) >= args.max_total_records:
            break
        try:
            search_url, found = sogou_search(
                opener=opener,
                keyword=keyword,
                site_query=args.site_query,
                max_results=args.search_top_n,
                pause_seconds=args.pause_seconds,
                timeout_seconds=args.timeout_seconds,
            )
        except Exception as exc:
            errors.append({"query": keyword, "error": str(exc)})
            print(f"search failed for {keyword}: {exc}", file=sys.stderr)
            continue
        for record in found:
            key = str(record.get("source_url") or record.get("source_id"))
            if not key or key in seen:
                continue
            seen.add(key)
            records.append(record)
            if len(records) >= args.max_total_records:
                break

    envelope = {
        "generatedAt": generated_at,
        "source": {
            "search": SOGOU_SEARCH_URL,
            "target": "https://www.zhihu.com / https://zhuanlan.zhihu.com",
        },
        "meta": {
            "keywords": keywords,
            "site_query": args.site_query,
            "search_top_n": args.search_top_n,
            "max_total_records": args.max_total_records,
            "timeout_seconds": args.timeout_seconds,
            "records_are_search_snippets": True,
            "direct_zhihu_fetch_note": "Direct anonymous Zhihu pages returned zse-ck anti-bot challenge during environment probing; collector preserves indexed snippets and target URLs.",
            "errors": errors,
        },
        "records": records,
    }
    output = Path(args.output)
    print(f"Wrote {len(records)} Zhihu search-snippet records to {output}")
    if errors:
        print(f"Completed with {len(errors)} fetch errors", file=sys.stderr)
    return write_collection_output(output, envelope, channel="zhihu", fail_on_errors=True, fail_on_login_wall=False)


if __name__ == "__main__":
    raise SystemExit(main())
