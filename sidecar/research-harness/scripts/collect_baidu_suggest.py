#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
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
CHANNEL_ID = "baidu-suggest"

DEFAULT_KEYWORDS = [
    "信息过载",
    "事情太多记不住",
    "答应别人的事忘了",
    "会议纪要",
    "聊天记录",
    "沟通记录待办",
    "待办事项",
    "滴答清单",
    "自动提取待办",
    "跟进客户待办",
]
SUGREC_URL = "https://www.baidu.com/sugrec"
SEARCH_URL = "https://www.baidu.com/s"


def _load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def load_default_keywords() -> list[str]:
    root = Path(__file__).resolve().parents[1]
    channel = _load_json(root / "channels" / "baidu-suggest.json")
    matrix = _load_json(root / "keyword_matrices" / "todo-extraction.json")
    keywords = (
        channel.get("crawl_plan", {}).get("keywords")
        or matrix.get("channel_keywords", {}).get("baidu-suggest")
        or []
    )
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
            "Accept": "application/json,text/plain,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.6",
            "Referer": "https://www.baidu.com/",
        },
    )
    with opener.open(request, timeout=timeout_seconds) as response:
        raw = response.read()
        charset = response.headers.get_content_charset() or "utf-8"
    return raw.decode(charset, errors="replace")


def _slug(text: str) -> str:
    return urllib.parse.quote(str(text or "").strip(), safe="")


def _search_url(phrase: str) -> str:
    return SEARCH_URL + "?" + urllib.parse.urlencode({"wd": phrase})


def fetch_suggestions(
    opener: urllib.request.OpenerDirector,
    keyword: str,
    max_suggestions: int,
    pause_seconds: float,
    timeout_seconds: float,
) -> tuple[str, list[str]]:
    params = {
        "prod": "pc",
        "wd": keyword,
        "json": "1",
        "_": str(int(time.time() * 1000)),
    }
    url = SUGREC_URL + "?" + urllib.parse.urlencode(params)
    payload = read_text(opener, url, timeout_seconds)
    time.sleep(pause_seconds)
    data = json.loads(payload)
    phrases: list[str] = []
    seen: set[str] = set()
    for item in data.get("g") or []:
        if not isinstance(item, dict):
            continue
        phrase = str(item.get("q") or "").strip()
        key = " ".join(phrase.split()).casefold()
        if not phrase or key in seen:
            continue
        seen.add(key)
        phrases.append(phrase)
        if len(phrases) >= max_suggestions:
            break
    return url, phrases


def build_records(keyword: str, suggest_url: str, phrases: list[str]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for rank, phrase in enumerate(phrases, start=1):
        records.append(
            {
                "source_id": f"baidu-suggest:{_slug(keyword)}:{rank}",
                "title": phrase,
                "source_url": _search_url(phrase),
                "record_type": "post",
                "query": keyword,
                "body": "",
                "comments": [],
                "metrics": {
                    "search_result_only": True,
                    "search_engine": "baidu-suggest",
                    "search_rank": rank,
                },
                "extra": {
                    "search_result_only": True,
                    "seed_keyword": keyword,
                    "suggest_url": suggest_url,
                },
            }
        )
    return records


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect Baidu suggestion long-tail words as search-calibration evidence.")
    parser.add_argument("--output", required=True, help="Output JSON path.")
    parser.add_argument("--keyword", action="append", default=[], help="Seed keyword. Repeatable.")
    parser.add_argument("--max-suggestions-per-seed", type=int, default=10)
    parser.add_argument("--max-total-records", type=int, default=80)
    parser.add_argument("--pause-seconds", type=float, default=0.5)
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
            operation="collect Baidu suggestion long-tail words",
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
            suggest_url, phrases = fetch_suggestions(
                opener=opener,
                keyword=keyword,
                max_suggestions=args.max_suggestions_per_seed,
                pause_seconds=args.pause_seconds,
                timeout_seconds=args.timeout_seconds,
            )
        except Exception as exc:
            errors.append({"query": keyword, "error": str(exc)})
            print(f"suggest failed for {keyword}: {exc}", file=sys.stderr)
            continue
        for record in build_records(keyword, suggest_url, phrases):
            key = f"{record['query']}||{record['title']}".casefold()
            if key in seen:
                continue
            seen.add(key)
            records.append(record)
            if len(records) >= args.max_total_records:
                break

    envelope = {
        "generatedAt": generated_at,
        "source": {
            "suggest": SUGREC_URL,
            "target": "https://www.baidu.com/s",
        },
        "meta": {
            "keywords": keywords,
            "max_suggestions_per_seed": args.max_suggestions_per_seed,
            "max_total_records": args.max_total_records,
            "timeout_seconds": args.timeout_seconds,
            "records_are_search_suggestions": True,
            "seeds_with_results": sorted({record["query"] for record in records}),
            "errors": errors,
        },
        "records": records,
    }
    output = Path(args.output)
    print(f"Wrote {len(records)} Baidu suggestion records to {output}")
    if errors:
        print(f"Completed with {len(errors)} fetch errors", file=sys.stderr)
    return write_collection_output(output, envelope, channel=CHANNEL_ID, fail_on_errors=True, fail_on_login_wall=False)


if __name__ == "__main__":
    raise SystemExit(main())
