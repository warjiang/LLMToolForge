#!/usr/bin/env python3
from __future__ import annotations

import argparse
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
CHANNEL_ID = "reddit"

DEFAULT_KEYWORDS = [
    "meeting notes action items",
    "AI meeting notes action items",
    "Slack tasks",
    "Slack to Todoist",
    "too many Slack messages",
    "forgot follow up",
    "sales follow up reminder",
    "customer follow up reminder",
    "extract tasks from messages",
    "I wish there was an app for tasks",
    "Fireflies review",
    "Otter AI meeting notes",
    "Todoist Slack",
]
DEFAULT_SUBREDDITS = [
    "productivity",
    "productivityapps",
    "Slack",
    "todoist",
    "Notion",
    "projectmanagement",
    "sales",
    "CustomerSuccess",
    "ADHD",
]
PULLPUSH_BASE = "https://api.pullpush.io/reddit/search"
REDDIT_BASE = "https://www.reddit.com"
RELEVANCE_CONTEXT_TERMS = {
    "task",
    "tasks",
    "todo",
    "to-do",
    "reminder",
    "reminders",
    "action",
    "items",
    "follow",
    "up",
    "message",
    "messages",
    "meeting",
    "meetings",
    "notes",
    "notetaker",
    "transcript",
    "transcription",
    "planner",
    "calendar",
    "slack",
    "teams",
    "discord",
    "otter",
    "fireflies",
    "zapier",
    "todoist",
}
STOPWORDS = {
    "a",
    "an",
    "and",
    "app",
    "for",
    "from",
    "i",
    "is",
    "of",
    "the",
    "there",
    "to",
    "too",
    "was",
    "wish",
    "with",
}


def _load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def load_channel_plan() -> dict[str, Any]:
    root = Path(__file__).resolve().parents[1]
    return (_load_json(root / "channels" / "reddit.json").get("crawl_plan") or {})


def load_default_keywords() -> list[str]:
    keywords = load_channel_plan().get("keywords") or []
    return [str(keyword) for keyword in keywords] or list(DEFAULT_KEYWORDS)


def load_default_subreddits() -> list[str]:
    subreddits = load_channel_plan().get("subreddits") or []
    return [str(subreddit) for subreddit in subreddits] or list(DEFAULT_SUBREDDITS)


def read_json(url: str, timeout_seconds: float) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": "research-harness/0.1"})
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        return json.load(response)


def _clean_text(value: object) -> str:
    text = str(value or "").strip()
    if text.lower() in {"[deleted]", "[removed]"}:
        return ""
    return text


def _reddit_url(permalink: object, fallback_id: object = "") -> str:
    path = str(permalink or "")
    if path.startswith("http"):
        return path
    if path.startswith("/"):
        return f"{REDDIT_BASE}{path}"
    fallback = str(fallback_id or "")
    if fallback:
        return f"{REDDIT_BASE}/comments/{fallback}"
    return ""


def _tokens(text: str) -> set[str]:
    return {token for token in re.findall(r"[a-z0-9]+", text.lower()) if token}


def _text_for_relevance(item: dict[str, Any]) -> str:
    return " ".join(
        str(item.get(key) or "")
        for key in ["title", "selftext", "subreddit", "domain", "url", "link_flair_text"]
    ).lower()


def is_relevant_submission(item: dict[str, Any], keyword: str) -> bool:
    text = _text_for_relevance(item)
    query_tokens = _tokens(keyword)
    content_tokens = _tokens(text)
    required = [token for token in query_tokens if token not in STOPWORDS and len(token) > 2]
    if not required:
        return True

    matched = sum(1 for token in required if token in content_tokens)
    if matched >= min(2, len(required)):
        if "fireflies" not in query_tokens:
            return True
        return bool(content_tokens & RELEVANCE_CONTEXT_TERMS - {"fireflies"})

    if {"teams", "microsoft"} & query_tokens and "teams" in content_tokens:
        return bool(content_tokens & {"task", "tasks", "todo", "planner", "action", "meeting", "notes", "reminder"})
    if "slack" in query_tokens and "slack" in content_tokens:
        return bool(content_tokens & {"task", "tasks", "todoist", "todo", "reminder", "message", "messages", "action"})
    if "discord" in query_tokens and "discord" in content_tokens:
        return bool(content_tokens & {"task", "tasks", "todo", "reminder", "bot", "messages"})
    if "otter" in query_tokens and "otter" in content_tokens:
        return bool(content_tokens & {"meeting", "meetings", "notes", "transcript", "transcription", "action"})
    if "fireflies" in query_tokens and "fireflies" in content_tokens:
        return bool(content_tokens & {"meeting", "meetings", "notes", "transcript", "transcription", "action", "notetaker"})
    return False


def _ordered_unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        key = value.casefold()
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(value)
    return result


def subreddits_for_keyword(keyword: str, configured: list[str], limit: int) -> list[str]:
    lower = keyword.lower()
    preferred: list[str] = []
    if "slack" in lower:
        preferred.extend(["Slack", "todoist", "productivityapps", "productivity", "projectmanagement"])
    if "microsoft" in lower or "teams" in lower or "planner" in lower:
        preferred.extend(["MicrosoftTeams", "productivity", "projectmanagement", "Office365", "MicrosoftToDo"])
    if "discord" in lower:
        preferred.extend(["discordapp", "productivityapps", "productivity"])
    if "fireflies" in lower or "otter" in lower or "meeting" in lower:
        preferred.extend(["productivity", "productivityapps", "projectmanagement", "sales", "CustomerSuccess"])
    if "sales" in lower or "customer" in lower:
        preferred.extend(["sales", "CustomerSuccess", "projectmanagement", "productivity"])
    if not preferred:
        preferred.extend(["productivity", "productivityapps", "todoist", "projectmanagement", "ADHD"])

    configured_lookup = {value.casefold(): value for value in configured}
    selected: list[str] = []
    for subreddit in preferred:
        selected.append(configured_lookup.get(subreddit.casefold(), subreddit))
    for subreddit in configured:
        selected.append(subreddit)
    return _ordered_unique(selected)[: max(1, limit)]


def search_queries_for_keyword(keyword: str) -> list[str]:
    lower = keyword.lower()
    queries = [keyword]
    if "discord reminders" in lower:
        queries = ["Discord reminder bot", keyword]
    elif "discord task bot" in lower:
        queries = ["Discord todo bot", keyword]
    elif "fireflies" in lower:
        queries = ["Fireflies AI meeting notes", "Fireflies.ai review", keyword]
    elif "otter" in lower:
        queries = ["Otter AI meeting notes action items", keyword]
    elif "teams to planner" in lower:
        queries = ["Microsoft Teams Planner tasks", keyword]
    elif "microsoft to do teams" in lower:
        queries = ["Microsoft Teams To Do tasks", keyword]
    return _ordered_unique(queries)


def _retry_sizes(size: int) -> list[int]:
    sizes = [size]
    if size > 2:
        sizes.append(2)
    if size > 1:
        sizes.append(1)
    return [int(value) for value in _ordered_unique([str(value) for value in sizes])]


def search_submissions(
    keyword: str,
    subreddit: str,
    size: int,
    pause_seconds: float,
    timeout_seconds: float,
    retry_count: int,
) -> list[dict[str, Any]]:
    last_error: Exception | None = None
    for retry_size in _retry_sizes(size):
        for _ in range(max(1, retry_count)):
            params = {
                "q": keyword,
                "size": retry_size,
                "sort_type": "score",
                "sort": "desc",
            }
            if subreddit:
                params["subreddit"] = subreddit
            url = f"{PULLPUSH_BASE}/submission/?" + urllib.parse.urlencode(params)
            try:
                data = read_json(url, timeout_seconds)
                time.sleep(pause_seconds)
                if data.get("error"):
                    raise RuntimeError(str(data.get("error")))
                return list(data.get("data") or [])
            except Exception as exc:
                last_error = exc
                time.sleep(pause_seconds)
    raise last_error or RuntimeError("unknown Reddit submission search failure")


def fetch_comments(
    submission_id: str,
    post_url: str,
    size: int,
    pause_seconds: float,
    timeout_seconds: float,
    retry_count: int,
) -> list[dict[str, Any]]:
    if not submission_id or size <= 0:
        return []
    data: dict[str, Any] = {}
    last_error: Exception | None = None
    for retry_size in _retry_sizes(size):
        for _ in range(max(1, retry_count)):
            params = {
                "link_id": f"t3_{submission_id}",
                "size": retry_size,
                "sort_type": "score",
                "sort": "desc",
            }
            url = f"{PULLPUSH_BASE}/comment/?" + urllib.parse.urlencode(params)
            try:
                data = read_json(url, timeout_seconds)
                time.sleep(pause_seconds)
                if data.get("error"):
                    raise RuntimeError(str(data.get("error")))
                last_error = None
                break
            except Exception as exc:
                last_error = exc
                time.sleep(pause_seconds)
        if not last_error:
            break
    if last_error:
        raise last_error
    comments: list[dict[str, Any]] = []
    for idx, item in enumerate(data.get("data") or [], start=1):
        body = _clean_text(item.get("body"))
        comment_id = str(item.get("id") or "")
        if not body or not comment_id:
            continue
        permalink = item.get("permalink") or f"{post_url.rstrip('/')}/comment/{comment_id}/"
        comments.append(
            {
                "comment_id": comment_id,
                "id": comment_id,
                "floor": idx,
                "nickname": item.get("author", ""),
                "content": body,
                "created": item.get("created_utc", ""),
                "score": item.get("score", ""),
                "source_url": _reddit_url(permalink),
            }
        )
    return comments


def submission_record(
    item: dict[str, Any],
    keyword: str,
    search_query: str,
    subreddit: str,
    comments: list[dict[str, Any]],
) -> dict[str, Any] | None:
    source_id = str(item.get("id") or "")
    title = _clean_text(item.get("title"))
    body = _clean_text(item.get("selftext"))
    if not source_id or not title:
        return None
    url = _reddit_url(item.get("permalink"), source_id)
    return {
        "source_id": source_id,
        "title": title,
        "source_url": url,
        "record_type": "post",
        "query": keyword,
        "body": body,
        "comments": comments,
        "metrics": {
            "score": item.get("score", ""),
            "num_comments": item.get("num_comments", ""),
            "created_utc": item.get("created_utc", ""),
            "subreddit": item.get("subreddit", subreddit),
            "query_subreddit": subreddit or "all",
            "upvote_ratio": item.get("upvote_ratio", ""),
            "retrieved_on": item.get("retrieved_on", ""),
        },
        "extra": {
            "author": item.get("author", ""),
            "domain": item.get("domain", ""),
            "url": item.get("url", ""),
            "pullpush_id": item.get("id", ""),
            "search_query": search_query,
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect Reddit evidence through PullPush.")
    parser.add_argument("--output", required=True, help="Output JSON path.")
    parser.add_argument("--keyword", action="append", default=[], help="Search keyword. Repeatable.")
    parser.add_argument("--subreddit", action="append", default=[], help="Subreddit. Repeatable.")
    parser.add_argument("--all-reddit", action="store_true", help="Search all Reddit instead of configured subreddit scopes.")
    parser.add_argument("--search-top-n", type=int, default=6)
    parser.add_argument("--comments-top-n", type=int, default=5)
    parser.add_argument("--max-total-records", type=int, default=80)
    parser.add_argument("--max-combinations", type=int, default=30)
    parser.add_argument("--subreddits-per-keyword", type=int, default=4)
    parser.add_argument("--pause-seconds", type=float, default=0.25)
    parser.add_argument("--timeout-seconds", type=float, default=8)
    parser.add_argument("--retry-count", type=int, default=2)
    parser.add_argument("--allow-irrelevant", action="store_true", help="Disable keyword relevance filtering.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    keywords = args.keyword or load_default_keywords()
    try:
        require_keyword_approval(
            ROOT,
            SCENARIO_ID,
            CHANNEL_ID,
            operation="collect Reddit evidence",
            keywords=keywords,
        )
    except KeywordApprovalError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    configured_subreddits = args.subreddit or load_default_subreddits()
    subreddits = [""] if args.all_reddit else configured_subreddits
    generated_at = datetime.now(timezone.utc).isoformat()
    records: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    seen: set[str] = set()
    combinations = 0
    searched_scopes: dict[str, list[str]] = {}
    searched_queries: dict[str, list[str]] = {}
    filtered_irrelevant = 0

    for keyword in keywords:
        search_queries = search_queries_for_keyword(keyword)
        searched_queries[keyword] = search_queries
        keyword_subreddits = subreddits if args.all_reddit else subreddits_for_keyword(
            keyword,
            configured_subreddits,
            args.subreddits_per_keyword,
        )
        searched_scopes[keyword] = keyword_subreddits
        for subreddit in keyword_subreddits:
            if combinations >= args.max_combinations or len(records) >= args.max_total_records:
                break
            combinations += 1
            submissions: list[dict[str, Any]] = []
            last_error: Exception | None = None
            used_search_query = keyword
            search_succeeded = False
            for search_query in search_queries:
                used_search_query = search_query
                try:
                    submissions = search_submissions(
                        search_query,
                        subreddit,
                        args.search_top_n,
                        args.pause_seconds,
                        args.timeout_seconds,
                        args.retry_count,
                    )
                    search_succeeded = True
                    if submissions:
                        break
                except Exception as exc:
                    last_error = exc
                    continue
            if not search_succeeded:
                exc = last_error or RuntimeError("unknown Reddit submission search failure")
                errors.append({"query": keyword, "subreddit": subreddit, "error": str(exc)})
                print(f"submission search failed for {keyword}/{subreddit}: {exc}", file=sys.stderr)
                continue
            for item in submissions:
                source_id = str(item.get("id") or "")
                if not source_id or source_id in seen:
                    continue
                if not args.allow_irrelevant and not is_relevant_submission(item, keyword):
                    filtered_irrelevant += 1
                    continue
                seen.add(source_id)
                post_url = _reddit_url(item.get("permalink"), source_id)
                try:
                    comments = fetch_comments(
                        source_id,
                        post_url,
                        args.comments_top_n,
                        args.pause_seconds,
                        args.timeout_seconds,
                        args.retry_count,
                    )
                except Exception as exc:
                    comments = []
                    errors.append({"query": keyword, "subreddit": subreddit, "source_id": source_id, "error": str(exc)})
                    print(f"comment fetch failed for {source_id}: {exc}", file=sys.stderr)
                record = submission_record(item, keyword, used_search_query, subreddit, comments)
                if not record:
                    continue
                records.append(record)
                if len(records) >= args.max_total_records:
                    break
        if combinations >= args.max_combinations or len(records) >= args.max_total_records:
            break

    envelope = {
        "generatedAt": generated_at,
        "source": {
            "submissions": f"{PULLPUSH_BASE}/submission/",
            "comments": f"{PULLPUSH_BASE}/comment/",
        },
        "meta": {
            "keywords": keywords,
            "subreddits": subreddits,
            "searched_scopes": searched_scopes,
            "searched_queries": searched_queries,
            "search_top_n": args.search_top_n,
            "comments_top_n": args.comments_top_n,
            "max_total_records": args.max_total_records,
            "max_combinations": args.max_combinations,
            "subreddits_per_keyword": args.subreddits_per_keyword,
            "timeout_seconds": args.timeout_seconds,
            "retry_count": args.retry_count,
            "searched_combinations": combinations,
            "filtered_irrelevant": filtered_irrelevant,
            "errors": errors,
        },
        "records": records,
    }
    output = Path(args.output)
    print(f"Wrote {len(records)} Reddit records to {output}")
    if errors:
        print(f"Completed with {len(errors)} fetch errors", file=sys.stderr)
    return write_collection_output(output, envelope, channel="reddit", fail_on_errors=True, fail_on_login_wall=False)


if __name__ == "__main__":
    raise SystemExit(main())
