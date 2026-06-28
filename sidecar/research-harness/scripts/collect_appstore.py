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
CHANNEL_ID = "appstore"

DEFAULT_KEYWORDS = [
    "滴答清单",
    "微软 To Do",
    "讯飞听见",
    "飞书妙记",
    "通义听悟",
    "Todoist",
    "TickTick",
    "Any.do",
    "Otter",
    "Fireflies",
    "Motion",
    "Reclaim",
]
DEFAULT_COUNTRIES = ["cn", "us"]
DEFAULT_SORTS = ["mostRecent", "mostHelpful"]


def _load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def load_default_keywords() -> list[str]:
    root = Path(__file__).resolve().parents[1]
    channel = _load_json(root / "channels" / "appstore.json")
    matrix = _load_json(root / "keyword_matrices" / "todo-extraction.json")
    keywords = channel.get("crawl_plan", {}).get("keywords") or matrix.get("channel_keywords", {}).get("appstore") or []
    return [str(keyword) for keyword in keywords] or list(DEFAULT_KEYWORDS)


def load_default_countries() -> list[str]:
    root = Path(__file__).resolve().parents[1]
    channel = _load_json(root / "channels" / "appstore.json")
    countries = channel.get("crawl_plan", {}).get("countries") or DEFAULT_COUNTRIES
    return [str(country).lower() for country in countries]


def load_allowed_primary_genres() -> set[str]:
    root = Path(__file__).resolve().parents[1]
    channel = _load_json(root / "channels" / "appstore.json")
    genres = channel.get("crawl_plan", {}).get("allowed_primary_genres") or []
    return {str(genre) for genre in genres if str(genre)}


def load_app_match_rules() -> dict[str, dict[str, list[str]]]:
    root = Path(__file__).resolve().parents[1]
    channel = _load_json(root / "channels" / "appstore.json")
    rules = channel.get("crawl_plan", {}).get("app_match_rules") or {}
    normalized: dict[str, dict[str, list[str]]] = {}
    for keyword, rule in rules.items():
        if not isinstance(rule, dict):
            continue
        normalized[str(keyword).lower()] = {
            "include_any": [str(term).lower() for term in rule.get("include_any", []) if str(term)],
            "exclude_any": [str(term).lower() for term in rule.get("exclude_any", []) if str(term)],
        }
    return normalized


def read_json(url: str) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=25) as response:
        return json.load(response)


def _label(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("label") or "")
    return str(value or "")


def _href(value: Any) -> str:
    if isinstance(value, dict):
        return str((value.get("attributes") or {}).get("href") or "")
    if isinstance(value, list):
        for item in value:
            href = _href(item)
            if href:
                return href
    return ""


def _matches_app_rule(app: dict[str, Any], rule: dict[str, list[str]] | None) -> bool:
    if not rule:
        return True
    haystack = " ".join(
        str(app.get(key) or "") for key in ["trackName", "sellerName", "bundleId", "trackViewUrl"]
    ).lower()
    include_any = rule.get("include_any") or []
    exclude_any = rule.get("exclude_any") or []
    if include_any and not any(term in haystack for term in include_any):
        return False
    if exclude_any and any(term in haystack for term in exclude_any):
        return False
    return True


def search_app(
    keyword: str,
    country: str,
    limit: int,
    pause_seconds: float,
    allowed_primary_genres: set[str],
    app_match_rules: dict[str, dict[str, list[str]]],
) -> dict[str, Any] | None:
    params = {
        "term": keyword,
        "country": country,
        "entity": "software",
        "limit": limit,
    }
    url = "https://itunes.apple.com/search?" + urllib.parse.urlencode(params)
    data = read_json(url)
    time.sleep(pause_seconds)
    results = data.get("results") or []
    if not results:
        return None
    if allowed_primary_genres:
        results = [item for item in results if str(item.get("primaryGenreName") or "") in allowed_primary_genres]
        if not results:
            return None
    rule = app_match_rules.get(keyword.lower())
    if rule:
        results = [item for item in results if _matches_app_rule(item, rule)]
        if not results:
            return None
    keyword_lower = keyword.lower().replace(" ", "")
    exact = [
        item
        for item in results
        if keyword_lower in str(item.get("trackName", "")).lower().replace(" ", "")
    ]
    return (exact or results)[0]


def fetch_reviews(
    app: dict[str, Any],
    query: str,
    country: str,
    sort: str,
    max_pages: int,
    max_rating: int,
    pause_seconds: float,
    errors: list[dict[str, str]] | None = None,
) -> list[dict[str, Any]]:
    app_id = str(app.get("trackId") or "")
    if not app_id:
        return []
    app_name = str(app.get("trackName") or query)
    app_url = str(app.get("trackViewUrl") or "")
    records: list[dict[str, Any]] = []
    for page in range(1, max_pages + 1):
        feed_url = f"https://itunes.apple.com/{country}/rss/customerreviews/id={app_id}/sortBy={sort}/page={page}/json"
        try:
            data = read_json(feed_url)
        except Exception as exc:
            print(f"review fetch failed for {query}/{country}/{sort}/page {page}: {exc}", file=sys.stderr)
            if errors is not None:
                errors.append({"surface": "appstore_reviews", "query": query, "country": country, "sort": sort, "page": str(page), "error": str(exc)})
            break
        time.sleep(pause_seconds)
        entries = data.get("feed", {}).get("entry") or []
        if isinstance(entries, dict):
            entries = [entries]
        if not entries:
            break
        for entry in entries:
            rating_text = _label(entry.get("im:rating"))
            try:
                rating = int(rating_text)
            except ValueError:
                continue
            if rating > max_rating:
                continue
            review_id = _label(entry.get("id"))
            title = _label(entry.get("title"))
            body = _label(entry.get("content"))
            if not review_id or not body:
                continue
            records.append(
                {
                    "source_id": f"{country}:{app_id}:{review_id}",
                    "title": f"{app_name} / {title}",
                    "source_url": _href(entry.get("link")) or app_url or feed_url,
                    "record_type": "review",
                    "query": query,
                    "body": body,
                    "metrics": {
                        "rating": rating,
                        "version": _label(entry.get("im:version")),
                        "updated": _label(entry.get("updated")),
                        "vote_sum": _label(entry.get("im:voteSum")),
                        "vote_count": _label(entry.get("im:voteCount")),
                        "app_id": app_id,
                        "app_name": app_name,
                        "app_url": app_url,
                        "country": country,
                        "sort": sort,
                        "rss_page": page,
                        "rss_url": feed_url,
                        "average_user_rating": app.get("averageUserRating", ""),
                        "user_rating_count": app.get("userRatingCount", ""),
                    },
                    "extra": {
                        "review_id": review_id,
                        "author": _label((entry.get("author") or {}).get("name")),
                        "seller_name": app.get("sellerName", ""),
                        "bundle_id": app.get("bundleId", ""),
                        "primary_genre": app.get("primaryGenreName", ""),
                    },
                }
            )
        if len(entries) < 50:
            break
    return records


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect low-star App Store reviews.")
    parser.add_argument("--output", required=True, help="Output JSON path.")
    parser.add_argument("--keyword", action="append", default=[], help="App keyword. Repeatable.")
    parser.add_argument("--country", action="append", default=[], help="App Store country code. Repeatable.")
    parser.add_argument("--search-limit", type=int, default=5)
    parser.add_argument("--max-pages", type=int, default=10)
    parser.add_argument("--max-rating", type=int, default=3)
    parser.add_argument("--max-reviews-per-app", type=int, default=20)
    parser.add_argument("--max-total-reviews", type=int, default=480)
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
            operation="collect App Store evidence",
            keywords=keywords,
        )
    except KeywordApprovalError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    countries = [country.lower() for country in (args.country or load_default_countries())]
    allowed_primary_genres = load_allowed_primary_genres()
    app_match_rules = load_app_match_rules()
    generated_at = datetime.now(timezone.utc).isoformat()

    apps: list[dict[str, Any]] = []
    records: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    seen_apps: set[tuple[str, str]] = set()
    seen_reviews: set[str] = set()
    for keyword in keywords:
        for country in countries:
            try:
                app = search_app(keyword, country, args.search_limit, args.pause_seconds, allowed_primary_genres, app_match_rules)
            except Exception as exc:
                print(f"search failed for {keyword}/{country}: {exc}", file=sys.stderr)
                errors.append({"surface": "appstore_search", "query": keyword, "country": country, "error": str(exc)})
                continue
            if not app:
                print(f"app not found for {keyword}/{country}", file=sys.stderr)
                continue
            app_id = str(app.get("trackId") or "")
            app_key = (country, app_id)
            if app_key in seen_apps:
                continue
            seen_apps.add(app_key)
            apps.append(
                {
                    "query": keyword,
                    "country": country,
                    "app_id": app_id,
                    "app_name": app.get("trackName", ""),
                    "seller_name": app.get("sellerName", ""),
                    "app_url": app.get("trackViewUrl", ""),
                    "average_user_rating": app.get("averageUserRating", ""),
                    "user_rating_count": app.get("userRatingCount", ""),
                }
            )
            app_records: list[dict[str, Any]] = []
            for sort in DEFAULT_SORTS:
                app_records.extend(
                    fetch_reviews(
                        app=app,
                        query=keyword,
                        country=country,
                        sort=sort,
                        max_pages=args.max_pages,
                        max_rating=args.max_rating,
                        pause_seconds=args.pause_seconds,
                        errors=errors,
                    )
                )
            for record in app_records:
                source_id = str(record["source_id"])
                if source_id in seen_reviews:
                    continue
                seen_reviews.add(source_id)
                records.append(record)
                if sum(1 for item in records if item["metrics"]["app_id"] == app_id and item["metrics"]["country"] == country) >= args.max_reviews_per_app:
                    break
            if len(records) >= args.max_total_reviews:
                records = records[: args.max_total_reviews]
                break
        if len(records) >= args.max_total_reviews:
            break

    envelope = {
        "generatedAt": generated_at,
        "source": {
            "search": "https://itunes.apple.com/search",
            "reviews": "https://itunes.apple.com/{country}/rss/customerreviews/id={app_id}/sortBy={sort}/page={page}/json",
        },
        "meta": {
            "keywords": keywords,
            "countries": countries,
            "sorts": DEFAULT_SORTS,
            "allowed_primary_genres": sorted(allowed_primary_genres),
            "app_match_rules": app_match_rules,
            "max_rating": args.max_rating,
            "max_pages": args.max_pages,
            "max_reviews_per_app": args.max_reviews_per_app,
            "apps": apps,
            "errors": errors,
        },
        "records": records,
    }
    output = Path(args.output)
    print(f"Wrote {len(records)} App Store review records to {output}")
    if errors:
        print(f"Completed with {len(errors)} collection errors", file=sys.stderr)
    return write_collection_output(output, envelope, channel="appstore", fail_on_errors=True, fail_on_login_wall=False)


if __name__ == "__main__":
    raise SystemExit(main())
