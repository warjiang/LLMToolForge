#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import urllib.parse
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
CHANNEL_ID = "xiaohongshu"

DEFAULT_KEYWORDS = [
    "微信 待办",
    "群消息 太多",
    "聊天记录 整理",
    "会议纪要 太麻烦",
    "待办 老忘",
]
SEARCH_URL_TEMPLATE = "https://www.xiaohongshu.com/search_result?keyword={query}&source=web_search_result_notes"


def _load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def load_default_keywords() -> list[str]:
    root = Path(__file__).resolve().parents[1]
    channel = _load_json(root / "channels" / "xiaohongshu.json")
    matrix = _load_json(root / "keyword_matrices" / "todo-extraction.json")
    keywords = channel.get("crawl_plan", {}).get("keywords") or matrix.get("channel_keywords", {}).get("xiaohongshu") or []
    return [str(keyword) for keyword in keywords] or list(DEFAULT_KEYWORDS)


def _hash_id(value: str, length: int = 16) -> str:
    return hashlib.sha1(value.encode("utf-8", errors="ignore")).hexdigest()[:length]


def clean_text(value: object) -> str:
    text = str(value or "")
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" -_|\n\t\r")


def _safe_filename(value: str) -> str:
    text = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff._-]+", "-", value).strip("-")
    return text[:60] or _hash_id(value, 8)


def _is_login_or_verification_wall(visible_text: str, result_count: int) -> bool:
    text = " ".join(str(visible_text or "").split())
    if not text:
        return False
    hard_block_terms = [
        "验证码",
        "安全验证",
        "安全校验",
        "访问太频繁",
        "请先登录",
        "扫码登录",
        "登录后查看",
        "登录小红书",
    ]
    if any(term in text for term in hard_block_terms):
        return True
    if result_count > 0:
        return False
    return any(term in text for term in ["登录", "扫码", "login", "captcha", "verification"])


def _normalize_note_url(url: object) -> str:
    value = str(url or "").strip()
    if not value:
        return ""
    if value.startswith("//"):
        value = "https:" + value
    if value.startswith("/"):
        value = urllib.parse.urljoin("https://www.xiaohongshu.com", value)
    if "xiaohongshu.com/explore/" in value:
        return value.split("?", 1)[0]
    return value


def _browser_extract(url: str, query: str, screenshot_path: Path, timeout_seconds: float, mode: str) -> dict[str, Any]:
    binary = shutil.which("browser-harness")
    if not binary:
        return {"query": query, "url": url, "mode": mode, "error": "browser-harness not found on PATH", "items": []}
    screenshot_path.parent.mkdir(parents=True, exist_ok=True)
    if mode == "search":
        js_extract = r"""
(() => {
  const anchors = Array.from(document.querySelectorAll('a[href*="/explore/"]'));
  const rows = [];
  const seen = new Set();
  for (const [idx, anchor] of anchors.entries()) {
    const href = anchor.href || '';
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const box = anchor.closest('section, article, div') || anchor;
    const text = (box.innerText || anchor.innerText || '').replace(/\s+/g, ' ').trim();
    const title = (anchor.innerText || text).replace(/\s+/g, ' ').trim();
    rows.push({rank: idx + 1, title: title.slice(0, 180), text: text.slice(0, 900), href});
  }
  return rows.slice(0, 80);
})()
"""
    else:
        js_extract = r"""
(() => {
  const title = document.querySelector('title')?.innerText ||
    document.querySelector('meta[property="og:title"]')?.content || '';
  const body = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
  const comments = Array.from(document.querySelectorAll('[class*="comment"], [class*="Comment"]'))
    .map((node, idx) => ({comment_id: String(idx + 1), content: (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 600)}))
    .filter(item => item.content && item.content.length >= 8)
    .slice(0, 20);
  return [{rank: 1, title: title.slice(0, 180), text: body.slice(0, 5000), href: location.href, comments}];
})()
"""
    script = f"""
import json
result = {{"query": {json.dumps(query, ensure_ascii=False)}, "url": {json.dumps(url)}, "mode": {json.dumps(mode)}, "items": []}}
try:
    new_tab({json.dumps(url)})
    wait_for_load(20)
    wait(3)
    js("window.scrollTo(0, Math.floor(document.body.scrollHeight * 0.5))")
    wait(1)
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
        return {"query": query, "url": url, "mode": mode, "error": str(exc), "items": []}
    payload: dict[str, Any] = {
        "query": query,
        "url": url,
        "mode": mode,
        "returncode": completed.returncode,
        "stderr": completed.stderr.strip()[-1000:],
    }
    for line in reversed([line for line in completed.stdout.splitlines() if line.strip()]):
        try:
            payload.update(json.loads(line))
            break
        except json.JSONDecodeError:
            continue
    if "items" not in payload:
        payload["items"] = []
        payload["error"] = payload.get("error") or "browser-harness produced no JSON payload"
        payload["stdout_tail"] = completed.stdout.strip()[-1000:]
    return payload


def _search_record(query: str, item: dict[str, Any], search_url: str, screenshot_path: str, idx: int) -> dict[str, Any] | None:
    url = _normalize_note_url(item.get("href"))
    title = clean_text(item.get("title")) or clean_text(str(item.get("text") or "")[:90])
    body = clean_text(item.get("text"))
    if not url or not title:
        return None
    rank = int(item.get("rank") or idx)
    return {
        "source_id": f"xhs:{_hash_id(url)}",
        "title": title,
        "source_url": url,
        "record_type": "post",
        "query": query,
        "body": body or title,
        "comments": [],
        "metrics": {
            "search_rank": rank,
            "captured_surface": "xiaohongshu_search",
            "screenshot_path": screenshot_path,
        },
        "extra": {
            "search_url": search_url,
            "search_result_only": True,
            "browser_harness": True,
        },
    }


def _detail_record(query: str, item: dict[str, Any], source_url: str, screenshot_path: str) -> dict[str, Any] | None:
    url = _normalize_note_url(item.get("href") or source_url)
    title = clean_text(item.get("title")) or clean_text(str(item.get("text") or "")[:90])
    body = clean_text(item.get("text"))
    if not url or not title or len(body) < 20:
        return None
    comments = [
        comment
        for comment in (item.get("comments") or [])
        if isinstance(comment, dict) and clean_text(comment.get("content"))
    ]
    return {
        "source_id": f"xhs:{_hash_id(url)}",
        "title": title,
        "source_url": url,
        "record_type": "post",
        "query": query,
        "body": body[:5000],
        "comments": comments,
        "metrics": {
            "captured_surface": "xiaohongshu_detail",
            "screenshot_path": screenshot_path,
            "comments_fetched": len(comments),
        },
        "extra": {
            "search_result_only": False,
            "browser_harness": True,
            "detail_fetch_status": "fetched",
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect Xiaohongshu public search/detail evidence through browser-harness.")
    parser.add_argument("--output", required=True, help="Output JSON path.")
    parser.add_argument("--keyword", action="append", default=[], help="Search keyword. Repeatable.")
    parser.add_argument("--search-top-n", type=int, default=20)
    parser.add_argument("--detail-top-n", type=int, default=8)
    parser.add_argument("--max-total-records", type=int, default=160)
    parser.add_argument("--timeout-seconds", type=float, default=55)
    parser.add_argument("--screenshots-dir", default="/private/tmp", help="Directory for browser screenshots.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    keywords = args.keyword or load_default_keywords()
    try:
        require_keyword_approval(
            ROOT,
            SCENARIO_ID,
            CHANNEL_ID,
            operation="collect Xiaohongshu evidence",
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
    detail_targets: list[tuple[str, str]] = []
    screenshots_dir = Path(args.screenshots_dir)

    for keyword in keywords:
        if len(records) >= args.max_total_records:
            break
        url = SEARCH_URL_TEMPLATE.format(query=urllib.parse.quote(keyword))
        probe = _browser_extract(
            url=url,
            query=keyword,
            screenshot_path=screenshots_dir / f"xhs-search-{_safe_filename(keyword)}.png",
            timeout_seconds=args.timeout_seconds,
            mode="search",
        )
        visible_text = str(probe.get("visible_text") or "")
        result_count = len(probe.get("items") or [])
        login_wall = _is_login_or_verification_wall(visible_text, result_count)
        probes.append({
            "surface": "xiaohongshu_search",
            "query": keyword,
            "url": url,
            "screenshot_path": probe.get("screenshot_path", ""),
            "result_count": result_count,
            "login_or_verification_wall": login_wall,
            "error": probe.get("error", ""),
        })
        if probe.get("error"):
            errors.append({"surface": "xiaohongshu_search", "query": keyword, "error": str(probe.get("error"))})
            continue
        for idx, item in enumerate((probe.get("items") or [])[: args.search_top_n], start=1):
            record = _search_record(keyword, item, url, str(probe.get("screenshot_path") or ""), idx)
            if not record:
                continue
            key = str(record.get("source_url") or record.get("source_id"))
            if key in seen:
                continue
            seen.add(key)
            records.append(record)
            detail_targets.append((keyword, str(record["source_url"])))
            if len(records) >= args.max_total_records:
                break

    for idx, (keyword, url) in enumerate(detail_targets[: args.detail_top_n], start=1):
        if len(records) >= args.max_total_records:
            break
        probe = _browser_extract(
            url=url,
            query=keyword,
            screenshot_path=screenshots_dir / f"xhs-detail-{idx}-{_safe_filename(keyword)}.png",
            timeout_seconds=args.timeout_seconds,
            mode="detail",
        )
        probes.append({
            "surface": "xiaohongshu_detail",
            "query": keyword,
            "url": url,
            "screenshot_path": probe.get("screenshot_path", ""),
            "result_count": len(probe.get("items") or []),
            "error": probe.get("error", ""),
        })
        if probe.get("error"):
            errors.append({"surface": "xiaohongshu_detail", "query": keyword, "source_url": url, "error": str(probe.get("error"))})
            continue
        for item in probe.get("items") or []:
            record = _detail_record(keyword, item, url, str(probe.get("screenshot_path") or ""))
            if not record:
                continue
            records.append(record)
            break

    envelope = {
        "generatedAt": generated_at,
        "source": {
            "search_template": SEARCH_URL_TEMPLATE,
            "target": "https://www.xiaohongshu.com",
        },
        "meta": {
            "keywords": keywords,
            "search_top_n": args.search_top_n,
            "detail_top_n": args.detail_top_n,
            "max_total_records": args.max_total_records,
            "records_are_public_browser_extracts": True,
            "probes": probes,
            "errors": errors,
            "collection_note": "Only public browser-visible Xiaohongshu search/detail content is collected. Login, verification, unavailable details, or hidden comments are recorded as probes/errors instead of fabricated evidence.",
        },
        "records": records[: args.max_total_records],
    }
    output = Path(args.output)
    print(f"Wrote {len(envelope['records'])} Xiaohongshu records to {output}")
    if errors:
        print(f"Completed with {len(errors)} collection errors", file=sys.stderr)
    return write_collection_output(output, envelope, channel="xiaohongshu", fail_on_errors=True, fail_on_login_wall=True)


if __name__ == "__main__":
    raise SystemExit(main())
