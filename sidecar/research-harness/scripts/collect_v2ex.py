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
CHANNEL_ID = "v2ex"

DEFAULT_KEYWORDS = [
    "微信聊天自动待办",
    "微信待办通知",
    "微信待办小程序",
    "微信群消息太多",
    "群消息太多 定位有用信息",
    "聊天记录总结升级",
    "AI 总结鸭 微信总结助手",
    "微信聊天记录导出工具",
    "wechat-cli 微信聊天分析",
    "OpenClaw 看微信消息",
    "OpenClaw 获取微信公众号",
    "企业微信 外部群 AI 机器人",
]

DEFAULT_TOPIC_IDS = [
    "1220035",
    "915556",
    "785235",
    "970445",
    "690832",
    "1058268",
    "1007924",
    "1018399",
    "595385",
    "705871",
    "865510",
    "1001223",
    "967094",
    "1192852",
    "1204659",
    "1181149",
    "1212320",
    "578450",
    "1200122",
    "1197494",
    "1198827",
    "1205042",
    "1211178",
    "357374",
    "556543",
    "507112",
]

DEFAULT_TOPIC_QUERIES = {
    "1220035": "微信聊天自动待办",
    "915556": "微信待办小程序",
    "705871": "微信聊天记录导出",
    "865510": "微信聊天记录导出需求",
    "1198827": "OpenClaw 获取微信公众号",
    "556543": "微信机器人采集群消息",
}


def load_default_keywords() -> list[str]:
    config_path = Path(__file__).resolve().parents[1] / "channels" / "v2ex.json"
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return list(DEFAULT_KEYWORDS)
    keywords = config.get("crawl_plan", {}).get("keywords") or []
    return [str(keyword) for keyword in keywords] or list(DEFAULT_KEYWORDS)


def build_opener(proxy: str) -> urllib.request.OpenerDirector:
    if not proxy:
        return urllib.request.build_opener()
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({"http": proxy, "https": proxy})
    )


def read_json(opener: urllib.request.OpenerDirector, url: str) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with opener.open(request, timeout=25) as response:
        return json.load(response)


def sov2ex_search(
    opener: urllib.request.OpenerDirector,
    keyword: str,
    size: int,
    pause_seconds: float,
) -> list[dict[str, Any]]:
    params = {
        "q": keyword,
        "sort": "sumup",
        "order": 0,
        "from": 0,
        "size": size,
        "node": "",
        "lte": 0,
        "gte": 0,
    }
    url = "https://www.sov2ex.com/api/search?" + urllib.parse.urlencode(params)
    data = read_json(opener, url)
    time.sleep(pause_seconds)
    records: list[dict[str, Any]] = []
    for hit in data.get("hits", []):
        source = hit.get("_source") or {}
        topic_id = str(source.get("id") or hit.get("_id") or "")
        if not topic_id:
            continue
        records.append(
            {
                "source_id": topic_id,
                "title": source.get("title", ""),
                "source_url": f"https://www.v2ex.com/t/{topic_id}",
                "record_type": "post",
                "query": keyword,
                "body": "",
                "comments": [],
                "metrics": {
                    "search_score": hit.get("_score", ""),
                    "search_replies": source.get("replies", ""),
                    "search_created": source.get("created", ""),
                },
                "extra": {
                    "search_source": "sov2ex",
                    "member": source.get("member", ""),
                    "node": source.get("node", ""),
                },
            }
        )
    return records


def fetch_topic(
    opener: urllib.request.OpenerDirector,
    topic_id: str,
    pause_seconds: float,
) -> dict[str, Any] | None:
    url = f"https://www.v2ex.com/api/topics/show.json?id={topic_id}"
    data = read_json(opener, url)
    time.sleep(pause_seconds)
    if not data:
        return None
    return data[0]


def fetch_replies(
    opener: urllib.request.OpenerDirector,
    topic_id: str,
    max_replies: int,
    pause_seconds: float,
) -> list[dict[str, Any]]:
    replies: list[dict[str, Any]] = []
    page = 1
    while len(replies) < max_replies:
        url = f"https://www.v2ex.com/api/replies/show.json?topic_id={topic_id}&page={page}"
        data = read_json(opener, url)
        time.sleep(pause_seconds)
        if not data:
            break
        for item in data:
            if len(replies) >= max_replies:
                break
            floor = len(replies) + 1
            member = item.get("member") or {}
            replies.append(
                {
                    "comment_id": str(item.get("id") or ""),
                    "id": str(item.get("id") or ""),
                    "floor": floor,
                    "nickname": member.get("username", ""),
                    "content": item.get("content", ""),
                    "created": item.get("created", ""),
                    "source_url": f"https://www.v2ex.com/t/{topic_id}#reply{floor}",
                }
            )
        if len(data) < 100:
            break
        page += 1
    return replies


def topic_record(topic: dict[str, Any], query: str, comments: list[dict[str, Any]]) -> dict[str, Any]:
    topic_id = str(topic.get("id") or "")
    node = topic.get("node") or {}
    member = topic.get("member") or {}
    return {
        "source_id": topic_id,
        "title": topic.get("title", ""),
        "source_url": topic.get("url") or f"https://www.v2ex.com/t/{topic_id}",
        "record_type": "post",
        "query": query,
        "body": topic.get("content", ""),
        "comments": comments,
        "metrics": {
            "replies": topic.get("replies", ""),
            "created": topic.get("created", ""),
            "last_touched": topic.get("last_touched", ""),
        },
        "extra": {
            "member": member.get("username", ""),
            "node": node.get("name", ""),
            "node_title": node.get("title", ""),
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect V2EX topic and reply evidence.")
    parser.add_argument("--output", required=True, help="Output JSON path.")
    parser.add_argument("--proxy", default="http://127.0.0.1:7890", help="HTTP proxy, empty to disable.")
    parser.add_argument("--keyword", action="append", default=[], help="SOV2EX search keyword. Repeatable.")
    parser.add_argument("--topic-id", action="append", default=[], help="V2EX topic id to fetch. Repeatable.")
    parser.add_argument("--skip-default-topics", action="store_true", help="Do not fetch the built-in topic-id seed list.")
    parser.add_argument("--search-top-n", type=int, default=8)
    parser.add_argument("--max-search-records", type=int, default=40)
    parser.add_argument("--comments-top-n", type=int, default=20)
    parser.add_argument("--pause-seconds", type=float, default=0.2)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    keywords = args.keyword or load_default_keywords()
    try:
        require_keyword_approval(
            ROOT,
            SCENARIO_ID,
            CHANNEL_ID,
            operation="collect V2EX evidence",
            keywords=keywords,
        )
    except KeywordApprovalError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    topic_seed = args.topic_id if (args.topic_id or args.skip_default_topics) else DEFAULT_TOPIC_IDS
    topic_ids = [str(item) for item in topic_seed]
    opener = build_opener(args.proxy)
    generated_at = datetime.now(timezone.utc).isoformat()

    search_records: list[dict[str, Any]] = []
    topic_query: dict[str, str] = {}
    errors: list[dict[str, str]] = []
    for keyword in keywords:
        try:
            results = sov2ex_search(opener, keyword, args.search_top_n, args.pause_seconds)
        except Exception as exc:
            print(f"search failed for {keyword}: {exc}", file=sys.stderr)
            errors.append({"surface": "sov2ex_search", "query": keyword, "error": str(exc)})
            continue
        for record in results:
            source_id = record["source_id"]
            topic_query.setdefault(source_id, keyword)
            search_records.append(record)

    full_records: list[dict[str, Any]] = []
    for topic_id in topic_ids:
        try:
            topic = fetch_topic(opener, topic_id, args.pause_seconds)
            if not topic:
                print(f"topic not found: {topic_id}", file=sys.stderr)
                errors.append({"surface": "v2ex_topic", "topic_id": topic_id, "error": "topic_not_found"})
                continue
            replies = fetch_replies(opener, topic_id, args.comments_top_n, args.pause_seconds)
        except Exception as exc:
            print(f"topic fetch failed for {topic_id}: {exc}", file=sys.stderr)
            errors.append({"surface": "v2ex_topic", "topic_id": topic_id, "error": str(exc)})
            continue
        full_records.append(
            topic_record(topic, topic_query.get(topic_id, DEFAULT_TOPIC_QUERIES.get(topic_id, "direct-topic")), replies)
        )

    fetched_ids = {record["source_id"] for record in full_records}
    seen_search: set[str] = set()
    selected_search_records: list[dict[str, Any]] = []
    for record in search_records:
        source_id = record["source_id"]
        if source_id in fetched_ids or source_id in seen_search:
            continue
        seen_search.add(source_id)
        selected_search_records.append(record)
        if len(selected_search_records) >= args.max_search_records:
            break

    envelope = {
        "generatedAt": generated_at,
        "source": {
            "search": "https://www.sov2ex.com/api/search",
            "topics": "https://www.v2ex.com/api/topics/show.json",
            "replies": "https://www.v2ex.com/api/replies/show.json",
        },
        "meta": {
            "keywords": keywords,
            "topic_ids": topic_ids,
            "search_top_n": args.search_top_n,
            "comments_top_n": args.comments_top_n,
            "fetched_topics": len(full_records),
            "search_only_records": len(selected_search_records),
            "errors": errors,
        },
        "records": full_records + selected_search_records,
    }

    output = Path(args.output)
    print(f"Wrote {len(envelope['records'])} records to {output}")
    if errors:
        print(f"Completed with {len(errors)} collection errors", file=sys.stderr)
    return write_collection_output(output, envelope, channel="v2ex", fail_on_errors=True, fail_on_login_wall=False)


if __name__ == "__main__":
    raise SystemExit(main())
