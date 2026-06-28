#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import html
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
CHANNEL_ID = "appstore"

GOOGLE_PLAY_DETAILS = "https://play.google.com/store/apps/details?id={package}&hl=en&gl=US"
MYAPP_REVIEW = "https://sj.qq.com/appdetail/{package}/review"
XIAOMI_DETAILS = "https://app.mi.com/details?id={package}"
HUAWEI_SEARCH = "https://web-drcn.hispace.dbankcloud.com/edge/index/completeSearchWord"
HUAWEI_COMMENTS = "https://web-drcn.hispace.dbankcloud.com/edge/uowap/index"
HUAWEI_DETAILS = "https://appgallery.huawei.com/app/{appid}"
VIVO_SEARCH = "https://h5-api.appstore.vivo.com.cn/h5appstore/search/result-list"
VIVO_DETAILS = "https://h5-api.appstore.vivo.com.cn/detailInfo"
VIVO_H5_DETAILS = "https://h5.appstore.vivo.com.cn/#/details?appId={appid}"
OPPO_H5_INDEX = "https://app.cdo.oppomobile.com/home/store/index.json"
OPPO_H5_REQUIRED = "https://app.cdo.oppomobile.com/home/store/required.json"
OPPO_SEARCH = "https://api-cn.store.heytapmobi.com/search/v1/search"
OPPO_DETAILS_APPS = "https://api-cn.store.heytapmobi.com/detail/v4/apps"
OPPO_COMMENTS = "https://api-cn.store.heytapmobi.com/common/v1/comment/list"

ANDROID_MARKET_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36"
VIVO_MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; vivo X90 Build/TP1A.220624.014) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36"
OPPO_MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; OPPO Find X5 Build/TP1A.220624.014) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36"
OPPO_OAK = "cdb09c43063ea6bb"
OPPO_ID = "300000000078961"
OPPO_OCS = "Android%2FOPPO%2F33%2F13%2FUNKNOWN%2F2%2Frelease-keys%2F81040"
OPPO_SIGN_PREFIX = "cdb09c43063ea6bb08f4fe8a43775179bdc58acb383220be"
OPPO_SIGN_SUFFIX = (
    "STORENEWMIICeAIBADANBgkqhkiG9w0BAQEFAASCAmIwggJeAgEAAoGBANYFY/UJGSzhIhpx6YM5KJ9yRHc7YeURxzb9tDvJvMfENHlnP3DtVkOIjERbpsSd76fjtZnMWY60TpGLGyrNkvuV40L15JQhHAo9yURpPQoI0eg3SLFmTEI/MUiPRCwfwYf2deqKKlsmMSysYYHX9JiGzQuWiYZaawxprSuiqDGvAgMBAAECgYEAtQ0QV00gGABISljNMy5aeDBBTSBWG2OjxJhxLRbndZM81OsMFysgC7dq+bUS6ke1YrDWgsoFhRxxTtx/2gDYciGp/c/h0Td5pGw7T9W6zo2xWI5oh1WyTnn0Xj17O9CmOk4fFDpJ6bapL+fyDy7gkEUChJ9+p66WSAlsfUhJ2TECQQD5sFWMGE2IiEuz4fIPaDrNSTHeFQQr/ZpZ7VzB2tcG7GyZRx5YORbZmX1jR7l3H4F98MgqCGs88w6FKnCpxDK3AkEA225CphAcfyiH0ShlZxEXBgIYt3V8nQuc/g2KJtiV6eeFkxmOMHbVTPGkARvt5VoPYEjwPTg43oqTDJVtlWagyQJBAOvEeJLno9aHNExvznyD4/pR4hec6qqLNgMyIYMfHCl6d3UodVvC1HO1/nMPl+4GvuRnxuoBtxj/PTe7AlUbYPMCQQDOkf4sVv58tqslO+I6JNyHy3F5RCELtuMUR6rG5x46FLqqwGQbO8ORq+m5IZHTV/Uhr4h6GXNwDQRh1EpVW0gBAkAp/v3tPI1riz6UuG0I6uf5er26yl5evPyPrjrD299L4Qy/1EIunayC7JYcSGlR01+EDYYgwUkec+QgrRC/NstV"
)

DEFAULT_OPPO_APP_IDS = {
    "com.ss.android.lark": 3699449,
}


DEFAULT_GOOGLE_PLAY_TARGETS = [
    {"query": "Todoist", "package": "com.todoist", "category": "todo_task"},
    {"query": "TickTick", "package": "com.ticktick.task", "category": "todo_task"},
    {"query": "Microsoft To Do", "package": "com.microsoft.todos", "category": "todo_task"},
    {"query": "Any.do", "package": "com.anydo", "category": "todo_task"},
    {"query": "Otter", "package": "com.aisense.otter", "category": "meeting_transcription"},
    {"query": "Fireflies", "package": "ai.fireflies.mobile", "category": "meeting_transcription"},
    {"query": "Motion", "package": "com.usemotion.motion", "category": "ai_schedule_assistant"},
]

DEFAULT_DOMESTIC_TARGETS = [
    {"query": "滴答清单", "package": "cn.ticktick.task", "category": "todo_task", "stores": ["myapp", "xiaomi", "huawei", "vivo", "oppo"]},
    {"query": "微软 To Do", "package": "com.microsoft.todos", "category": "todo_task", "stores": ["myapp", "xiaomi", "huawei", "vivo", "oppo"]},
    {"query": "讯飞听见", "package": "com.iflyrec.tjapp", "category": "meeting_transcription", "stores": ["myapp", "xiaomi", "huawei", "vivo", "oppo"]},
    {"query": "飞书", "package": "com.ss.android.lark", "category": "meeting_transcription", "stores": ["myapp", "xiaomi", "huawei", "vivo", "oppo"], "oppo_app_id": 3699449},
]


def _load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _targets() -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    root = Path(__file__).resolve().parents[1]
    channel = _load_json(root / "channels" / "appstore.json")
    target_config = channel.get("crawl_plan", {}).get("android_market_targets") or {}
    google = target_config.get("google_play") or DEFAULT_GOOGLE_PLAY_TARGETS
    domestic = target_config.get("domestic_android") or DEFAULT_DOMESTIC_TARGETS
    unresolved = target_config.get("domestic_unresolved_stores") if "domestic_unresolved_stores" in target_config else ["OPPO 软件商店"]
    return list(google), list(domestic), list(unresolved)


def _read_text(url: str, *, lang: str = "en-US,en;q=0.9", timeout: int = 30) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": ANDROID_MARKET_UA,
            "Accept-Language": lang,
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", "ignore")


def _request_json(
    url: str,
    *,
    method: str = "GET",
    params: dict[str, Any] | None = None,
    data: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 30,
) -> dict[str, Any]:
    if params:
        separator = "&" if "?" in url else "?"
        url = f"{url}{separator}{urllib.parse.urlencode(params)}"
    body = None
    request_headers = {
        "User-Agent": ANDROID_MARKET_UA,
        "Accept": "application/json, text/plain, */*",
    }
    if headers:
        request_headers.update(headers)
    if data is not None:
        body = urllib.parse.urlencode(data).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
    request = urllib.request.Request(url, data=body, headers=request_headers, method=method)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        text = response.read().decode("utf-8", "ignore")
    if not text:
        return {}
    return json.loads(text)


def _clean(text: object) -> str:
    value = html.unescape(str(text or ""))
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def _extract_json_script(text: str, script_id: str) -> dict[str, Any] | None:
    pattern = rf'<script id="{re.escape(script_id)}" type="application/json"[^>]*>(.*?)</script>'
    match = re.search(pattern, text, re.S)
    if not match:
        return None
    return json.loads(html.unescape(match.group(1)))


def _extract_af_data(text: str, key: str) -> Any | None:
    key_pos = text.find(f"key: '{key}'")
    if key_pos < 0:
        return None
    data_pos = text.find("data:", key_pos)
    if data_pos < 0:
        return None
    start = data_pos + len("data:")
    while start < len(text) and text[start].isspace():
        start += 1
    if start >= len(text):
        return None
    open_char = text[start]
    close_char = "]" if open_char == "[" else "}"
    depth = 0
    in_string = False
    escaped = False
    for idx in range(start, len(text)):
        char = text[idx]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == open_char:
            depth += 1
        elif char == close_char:
            depth -= 1
            if depth == 0:
                return json.loads(text[start : idx + 1])
    return None


def _timestamp_to_iso(value: Any) -> str:
    try:
        return datetime.fromtimestamp(int(value), timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return ""


def _timestamp_millis_to_iso(value: Any) -> str:
    try:
        timestamp = int(float(str(value).strip()))
    except (TypeError, ValueError):
        return ""
    if timestamp > 10_000_000_000:
        timestamp = timestamp // 1000
    return _timestamp_to_iso(timestamp)


def _title_from_html(text: str) -> str:
    match = re.search(r"<title[^>]*>(.*?)</title>", text, re.S)
    if not match:
        return ""
    return _clean(match.group(1)).replace(" - Apps on Google Play", "")


def _stores_for(target: dict[str, Any], default_store: str) -> set[str]:
    return set(target.get("stores") or [default_store])


def _int_value(value: Any, default: int = 0) -> int:
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return default


def _term_key(value: object) -> str:
    return " ".join(str(value or "").split()).casefold()


def _filter_targets_by_query(targets: list[dict[str, Any]], queries: list[str]) -> list[dict[str, Any]]:
    if not queries:
        return targets
    allowed = {_term_key(query) for query in queries if _term_key(query)}
    return [target for target in targets if _term_key(target.get("query")) in allowed]


def collect_google_play(targets: list[dict[str, Any]], max_reviews_per_app: int, pause_seconds: float) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for target in targets:
        package = str(target.get("package") or "")
        if not package:
            continue
        url = GOOGLE_PLAY_DETAILS.format(package=urllib.parse.quote(package))
        try:
            text = _read_text(url, lang="en-US,en;q=0.9")
        except Exception as exc:
            print(f"google play fetch failed for {package}: {exc}", file=sys.stderr)
            continue
        time.sleep(pause_seconds)
        app_name = _title_from_html(text) or str(target.get("query") or package)
        data = _extract_af_data(text, "ds:11")
        review_rows = (data or [[]])[0] if isinstance(data, list) else []
        kept = 0
        for review in review_rows:
            if not isinstance(review, list) or len(review) < 6:
                continue
            try:
                rating = int(review[2])
            except (TypeError, ValueError):
                continue
            body = str(review[4] or "").strip()
            if rating > 3 or not body:
                continue
            review_id = str(review[0] or f"{package}:{kept}")
            author = ""
            if isinstance(review[1], list) and review[1]:
                author = str(review[1][0] or "")
            developer_reply = ""
            developer_reply_at = ""
            if len(review) > 7 and isinstance(review[7], list):
                developer_reply = str(review[7][1] or "") if len(review[7]) > 1 else ""
                if len(review[7]) > 2 and isinstance(review[7][2], list):
                    developer_reply_at = _timestamp_to_iso(review[7][2][0])
            records.append(
                {
                    "source_id": f"google-play:{package}:{review_id}",
                    "title": f"Google Play / {app_name}",
                    "source_url": f"{url}&reviewId={urllib.parse.quote(review_id)}",
                    "record_type": "review",
                    "query": str(target.get("query") or app_name),
                    "body": body,
                    "metrics": {
                        "rating": rating,
                        "app_id": package,
                        "app_name": app_name,
                        "store_name": "Google Play",
                        "market_segment": "google-play",
                        "market_group": "海外应用市场",
                        "country": "us",
                        "updated": _timestamp_to_iso((review[5] or [None])[0] if isinstance(review[5], list) else None),
                        "thumbs_up": review[6] if len(review) > 6 else "",
                        "developer_reply": developer_reply,
                        "developer_reply_at": developer_reply_at,
                    },
                    "extra": {
                        "author": author,
                        "package": package,
                        "app_category": target.get("category", ""),
                        "source_parser": "google_play_af_ds11",
                    },
                }
            )
            kept += 1
            if kept >= max_reviews_per_app:
                break
    return records


def _myapp_payload(text: str) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]] | None:
    data = _extract_json_script(text, "__NEXT_DATA__")
    if not data:
        return None
    components = (((data.get("props") or {}).get("pageProps") or {}).get("dynamicCardResponse") or {}).get("data", {}).get("components", [])
    for component in components:
        item_data = (component.get("data") or {}).get("itemData") or []
        if len(item_data) >= 3 and isinstance(item_data[0], dict) and "comments" in item_data[2]:
            return item_data[0], item_data[1].get("appScore") or {}, item_data[2].get("comments") or []
    return None


def collect_myapp(targets: list[dict[str, Any]], max_reviews_per_app: int, pause_seconds: float) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for target in targets:
        stores = set(target.get("stores") or ["myapp"])
        if "myapp" not in stores:
            continue
        package = str(target.get("package") or "")
        url = MYAPP_REVIEW.format(package=urllib.parse.quote(package))
        try:
            text = _read_text(url, lang="zh-CN,zh;q=0.9")
        except Exception as exc:
            print(f"myapp fetch failed for {package}: {exc}", file=sys.stderr)
            continue
        time.sleep(pause_seconds)
        payload = _myapp_payload(text)
        if not payload:
            continue
        app, score, comments = payload
        app_name = str(app.get("name") or target.get("query") or package)
        score_body = (
            f"应用宝评分 {score.get('score', '')}，评分人数 {score.get('total', '')}；"
            f"低星分布：1星 {((score.get('mulScore') or {}).get('1') or 0)}、"
            f"2星 {((score.get('mulScore') or {}).get('2') or 0)}、"
            f"3星 {((score.get('mulScore') or {}).get('3') or 0)}。"
        )
        records.append(
            {
                "source_id": f"myapp:{package}:score",
                "title": f"应用宝 / {app_name} / 评分分布",
                "source_url": url,
                "record_type": "metric",
                "query": str(target.get("query") or app_name),
                "body": score_body,
                "metrics": {
                    "app_id": str(app.get("app_id") or package),
                    "package": package,
                    "app_name": app_name,
                    "store_name": "应用宝",
                    "market_segment": "domestic-android",
                    "market_group": "国内应用市场",
                    "rating": score.get("score", ""),
                    "rating_count": score.get("total", ""),
                    "rating_1_count": (score.get("mulScore") or {}).get("1", ""),
                    "rating_2_count": (score.get("mulScore") or {}).get("2", ""),
                    "rating_3_count": (score.get("mulScore") or {}).get("3", ""),
                    "version": app.get("version_name", ""),
                    "updated": app.get("update_time", ""),
                    "developer": app.get("developer", ""),
                },
                "extra": {
                    "package": package,
                    "app_category": target.get("category", ""),
                    "source_parser": "myapp_next_data_score",
                },
            }
        )
        kept = 0
        for item in comments:
            comment = item.get("comment") or {}
            user = item.get("user") or {}
            body = str(comment.get("content") or "").strip()
            try:
                rating = int((comment.get("mulDimensionScore") or {}).get("total") or 0)
            except (TypeError, ValueError):
                rating = 0
            if rating > 3 or not body:
                continue
            comment_id = str(comment.get("commentID") or f"{package}:{kept}")
            records.append(
                {
                    "source_id": f"myapp:{package}:{comment_id}",
                    "title": f"应用宝 / {app_name} / 用户评论",
                    "source_url": url,
                    "record_type": "review",
                    "query": str(target.get("query") or app_name),
                    "body": body,
                    "metrics": {
                        "rating": rating,
                        "app_id": str(app.get("app_id") or package),
                        "package": package,
                        "app_name": app_name,
                        "store_name": "应用宝",
                        "market_segment": "domestic-android",
                        "market_group": "国内应用市场",
                        "country": "cn",
                        "updated": _timestamp_to_iso(comment.get("createTime")),
                        "praise_num": comment.get("praiseNum", ""),
                        "reply_num": comment.get("replyNum", ""),
                    },
                    "extra": {
                        "author": user.get("nickName", ""),
                        "package": package,
                        "app_category": target.get("category", ""),
                        "source_parser": "myapp_next_data_comment",
                    },
                }
            )
            kept += 1
            if kept >= max_reviews_per_app:
                break
    return records


def collect_xiaomi_metrics(targets: list[dict[str, Any]], pause_seconds: float) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for target in targets:
        stores = set(target.get("stores") or ["xiaomi"])
        if "xiaomi" not in stores:
            continue
        package = str(target.get("package") or "")
        url = XIAOMI_DETAILS.format(package=urllib.parse.quote(package))
        try:
            text = _read_text(url, lang="zh-CN,zh;q=0.9", timeout=20)
        except Exception as exc:
            print(f"xiaomi fetch failed for {package}: {exc}", file=sys.stderr)
            continue
        time.sleep(pause_seconds)
        title_match = re.search(r"<title>(.*?)</title>", text, re.S)
        title = _clean(title_match.group(1)) if title_match else ""
        if not title or title.startswith("手机游戏应用商店"):
            continue
        app_name_match = re.search(r"<h3[^>]*>(.*?)</h3>", text, re.S)
        app_name = _clean(app_name_match.group(1)) if app_name_match else str(target.get("query") or package)
        rating_count_match = re.search(r'app-intro-comment[^>]*>\s*\(\s*([^)]+?)\s*\)', text, re.S)
        rating_count = _clean(rating_count_match.group(1)) if rating_count_match else ""
        star_match = re.search(r"star1-hover\s+star1-(\d+)", text)
        rating = ""
        if star_match:
            try:
                rating = str(int(star_match.group(1)) / 2)
            except ValueError:
                rating = ""
        version_match = re.search(r"版本号\s*</div>\s*<div[^>]*>\s*([^<]+)", text, re.S)
        developer_match = re.search(r"开发者\s*</div>\s*<div[^>]*>\s*([^<]+)", text, re.S)
        body = f"小米应用商店评分 {rating or '未识别'}，{rating_count or '评分人数未识别'}；公开页未发现逐条评论正文。"
        records.append(
            {
                "source_id": f"xiaomi:{package}:score",
                "title": f"小米应用商店 / {app_name} / 评分页",
                "source_url": url,
                "record_type": "metric",
                "query": str(target.get("query") or app_name),
                "body": body,
                "metrics": {
                    "package": package,
                    "app_name": app_name,
                    "store_name": "小米应用商店",
                    "market_segment": "domestic-android",
                    "market_group": "国内应用市场",
                    "rating": rating,
                    "rating_count_text": rating_count,
                    "version": _clean(version_match.group(1)) if version_match else "",
                    "developer": _clean(developer_match.group(1)) if developer_match else "",
                    "comments_publicly_visible": False,
                },
                "extra": {
                    "package": package,
                    "app_category": target.get("category", ""),
                    "source_parser": "xiaomi_html_score",
                },
            }
        )
    return records


def _huawei_headers(appid: str | None = None) -> dict[str, str]:
    referer = HUAWEI_DETAILS.format(appid=appid) if appid else "https://appgallery.huawei.com/"
    return {
        "User-Agent": ANDROID_MARKET_UA,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Origin": "https://appgallery.huawei.com",
        "Referer": referer,
    }


def _huawei_match_app(target: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any] | None:
    expected_package = str(target.get("package") or "")
    candidates: list[dict[str, Any]] = []
    if isinstance(payload.get("app"), dict):
        candidates.append(payload["app"])
    if isinstance(payload.get("appList"), list):
        candidates.extend(item for item in payload["appList"] if isinstance(item, dict))
    for app in candidates:
        if str(app.get("package") or "") == expected_package:
            return app
    return None


def _huawei_find_app(target: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    query = str(target.get("query") or target.get("package") or "")
    payload = _request_json(
        HUAWEI_SEARCH,
        method="POST",
        data={"serviceType": 20, "keyword": query},
        headers=_huawei_headers(),
    )
    return _huawei_match_app(target, payload), payload


def _rating_count(rating_dst: object, rating: int) -> Any:
    if not isinstance(rating_dst, list):
        return ""
    for item in rating_dst:
        if isinstance(item, dict) and _int_value(item.get("rating")) == rating:
            return item.get("ratingCounts", "")
    return ""


def collect_huawei_appgallery(
    targets: list[dict[str, Any]],
    max_reviews_per_app: int,
    pause_seconds: float,
    max_pages_per_app: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    records: list[dict[str, Any]] = []
    probes: list[dict[str, Any]] = []
    for target in targets:
        if "huawei" not in _stores_for(target, "huawei"):
            continue
        package = str(target.get("package") or "")
        try:
            app, discovery = _huawei_find_app(target)
        except Exception as exc:
            probes.append({"store": "华为应用市场", "query": target.get("query", ""), "package": package, "status": f"search_failed: {exc}"})
            print(f"huawei search failed for {package}: {exc}", file=sys.stderr)
            continue
        time.sleep(pause_seconds)
        if not app:
            found = ((discovery.get("app") or {}).get("package") if isinstance(discovery.get("app"), dict) else "") or ""
            probes.append(
                {
                    "store": "华为应用市场",
                    "query": target.get("query", ""),
                    "package": package,
                    "status": "no_exact_package_match",
                    "matched_package": found,
                }
            )
            continue

        appid = str(app.get("appid") or app.get("id") or "")
        if not appid:
            probes.append({"store": "华为应用市场", "query": target.get("query", ""), "package": package, "status": "missing_appid"})
            continue
        app_name = str(app.get("name") or target.get("query") or package)
        url = HUAWEI_DETAILS.format(appid=urllib.parse.quote(appid))
        seen: set[str] = set()
        kept = 0
        total_pages = 1
        for page in range(1, max_pages_per_app + 1):
            try:
                payload = _request_json(
                    HUAWEI_COMMENTS,
                    params={
                        "method": "internal.user.commenList3",
                        "serviceType": 20,
                        "reqPageNum": page,
                        "maxResults": 25,
                        "appid": appid,
                        "version": "10.0.0",
                    },
                    headers=_huawei_headers(appid),
                )
            except Exception as exc:
                probes.append({"store": "华为应用市场", "query": target.get("query", ""), "package": package, "status": f"comments_failed: {exc}"})
                print(f"huawei comments failed for {package}: {exc}", file=sys.stderr)
                break
            if page == 1:
                rating_dst = payload.get("ratingDstList")
                body = (
                    f"华为应用市场评分 {payload.get('score', '')}，评论/评分数 {payload.get('count', '')}；"
                    f"低星分布：1星 {_rating_count(rating_dst, 1)}、2星 {_rating_count(rating_dst, 2)}、3星 {_rating_count(rating_dst, 3)}；"
                    f"安装量 {app.get('downCountDesc', '')}，版本 {app.get('version', '')}。"
                )
                records.append(
                    {
                        "source_id": f"huawei:{appid}:score",
                        "title": f"华为应用市场 / {app_name} / 评分分布",
                        "source_url": url,
                        "record_type": "metric",
                        "query": str(target.get("query") or app_name),
                        "body": body,
                        "metrics": {
                            "app_id": appid,
                            "package": package,
                            "app_name": app_name,
                            "store_name": "华为应用市场",
                            "market_segment": "domestic-android",
                            "market_group": "国内应用市场",
                            "rating": payload.get("score", ""),
                            "rating_count": payload.get("count", ""),
                            "rating_1_count": _rating_count(rating_dst, 1),
                            "rating_2_count": _rating_count(rating_dst, 2),
                            "rating_3_count": _rating_count(rating_dst, 3),
                            "downloads": app.get("downloads", ""),
                            "download_count_text": app.get("downCountDesc", ""),
                            "version": app.get("version", ""),
                            "updated": app.get("releaseDate", ""),
                            "developer": app.get("developer", ""),
                        },
                        "extra": {
                            "package": package,
                            "app_category": target.get("category", ""),
                            "source_parser": "huawei_appgallery_search_commentlist3_score",
                        },
                    }
                )
                total_pages = max(1, _int_value(payload.get("totalPages"), 1))
            for item in payload.get("list") or []:
                if not isinstance(item, dict):
                    continue
                rating = _int_value(item.get("rating") or item.get("stars"))
                body = str(item.get("commentInfo") or "").strip()
                if rating > 3 or rating <= 0 or not body:
                    continue
                comment_id = str(item.get("commentId") or item.get("id") or f"{appid}:{page}:{kept}")
                if comment_id in seen:
                    continue
                seen.add(comment_id)
                records.append(
                    {
                        "source_id": f"huawei:{appid}:{comment_id}",
                        "title": f"华为应用市场 / {app_name} / 用户评论",
                        "source_url": f"{url}#/commentList/{urllib.parse.quote(appid)}",
                        "record_type": "review",
                        "query": str(target.get("query") or app_name),
                        "body": body,
                        "metrics": {
                            "rating": rating,
                            "app_id": appid,
                            "package": package,
                            "app_name": app_name,
                            "store_name": "华为应用市场",
                            "market_segment": "domestic-android",
                            "market_group": "国内应用市场",
                            "country": "cn",
                            "updated": item.get("operTime", ""),
                            "version": item.get("versionName", ""),
                            "phone": item.get("phone", ""),
                            "approve_counts": item.get("approveCounts", ""),
                            "reply_counts": item.get("replyCounts", ""),
                        },
                        "extra": {
                            "author": item.get("nickName", ""),
                            "package": package,
                            "app_category": target.get("category", ""),
                            "source_parser": "huawei_appgallery_commentlist3",
                        },
                    }
                )
                kept += 1
                if kept >= max_reviews_per_app:
                    break
            if kept >= max_reviews_per_app or page >= total_pages:
                break
            time.sleep(pause_seconds)
    return records, probes


def _vivo_headers() -> dict[str, str]:
    return {
        "User-Agent": VIVO_MOBILE_UA,
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://h5.appstore.vivo.com.cn",
        "Referer": "https://h5.appstore.vivo.com.cn/",
    }


def _vivo_common_params() -> dict[str, Any]:
    return {
        "h5_websource": "h5appstore",
        "model": "vivo X90",
        "app_version": "9200",
        "an": "13",
    }


def _vivo_search_app(target: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    query = str(target.get("query") or target.get("package") or "")
    params = {
        **_vivo_common_params(),
        "key": query,
        "page_index": 0,
        "apps_per_page": 20,
        "target": "local",
        "cfrom": 1,
    }
    payload = _request_json(VIVO_SEARCH, method="POST", params=params, headers=_vivo_headers())
    expected_package = str(target.get("package") or "")
    response = ((payload.get("data") or {}).get("appSearchResponse") or {}) if isinstance(payload, dict) else {}
    candidates = list(response.get("value") or [])
    for focus in response.get("focus") or []:
        if isinstance(focus, dict):
            candidates.extend(item for item in focus.get("apps") or [] if isinstance(item, dict))
    for app in candidates:
        if isinstance(app, dict) and str(app.get("package_name") or "") == expected_package:
            return app, payload
    return None, payload


def _vivo_detail(appid: Any) -> dict[str, Any]:
    params = {
        **_vivo_common_params(),
        "appId": appid,
        "frompage": "messageh5",
        "supportBundle": "true",
    }
    return _request_json(VIVO_DETAILS, method="POST", params=params, headers=_vivo_headers())


def collect_vivo_store(
    targets: list[dict[str, Any]],
    max_reviews_per_app: int,
    pause_seconds: float,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    records: list[dict[str, Any]] = []
    probes: list[dict[str, Any]] = []
    for target in targets:
        if "vivo" not in _stores_for(target, "vivo"):
            continue
        package = str(target.get("package") or "")
        try:
            app, search_payload = _vivo_search_app(target)
        except Exception as exc:
            probes.append({"store": "vivo 应用商店", "query": target.get("query", ""), "package": package, "status": f"search_failed: {exc}"})
            print(f"vivo search failed for {package}: {exc}", file=sys.stderr)
            continue
        time.sleep(pause_seconds)
        if not app:
            response = ((search_payload.get("data") or {}).get("appSearchResponse") or {}) if isinstance(search_payload, dict) else {}
            probes.append(
                {
                    "store": "vivo 应用商店",
                    "query": target.get("query", ""),
                    "package": package,
                    "status": "no_exact_package_match",
                    "result_count": response.get("totalCount", ""),
                }
            )
            continue
        appid = app.get("id")
        try:
            detail = _vivo_detail(appid)
        except Exception as exc:
            probes.append({"store": "vivo 应用商店", "query": target.get("query", ""), "package": package, "status": f"detail_failed: {exc}"})
            detail = app
        time.sleep(pause_seconds)
        app_name = str(detail.get("title_zh") or app.get("title_zh") or target.get("query") or package)
        source_url = VIVO_H5_DETAILS.format(appid=urllib.parse.quote(str(appid)))
        comments = detail.get("appComments") if isinstance(detail.get("appComments"), list) else []
        body = (
            f"vivo 应用商店评分 {detail.get('score', app.get('score', ''))}，评分人数 {detail.get('raters_count', '')}，"
            f"下载量 {detail.get('download_count', app.get('download_count', ''))}；详情接口返回逐条评论 {len(comments)} 条。"
        )
        records.append(
            {
                "source_id": f"vivo:{appid}:score",
                "title": f"vivo 应用商店 / {app_name} / 评分页",
                "source_url": source_url,
                "record_type": "metric",
                "query": str(target.get("query") or app_name),
                "body": body,
                "metrics": {
                    "app_id": appid,
                    "package": package,
                    "app_name": app_name,
                    "store_name": "vivo 应用商店",
                    "market_segment": "domestic-android",
                    "market_group": "国内应用市场",
                    "rating": detail.get("score", app.get("score", "")),
                    "rating_count": detail.get("raters_count", ""),
                    "downloads": detail.get("download_count", app.get("download_count", "")),
                    "version": detail.get("version_name", app.get("version_name", "")),
                    "updated": detail.get("upload_time", ""),
                    "developer": detail.get("developer", app.get("developer", "")),
                    "comments_publicly_visible": bool(comments),
                    "comments_returned": len(comments),
                },
                "extra": {
                    "package": package,
                    "app_category": target.get("category", ""),
                    "source_parser": "vivo_h5_search_detail_score",
                },
            }
        )
        kept = 0
        for idx, item in enumerate(comments):
            if not isinstance(item, dict):
                continue
            review_body = str(
                item.get("content") or item.get("comment") or item.get("commentInfo") or item.get("text") or ""
            ).strip()
            rating = _int_value(item.get("rating") or item.get("score") or item.get("stars"))
            if rating > 3 or rating <= 0 or not review_body:
                continue
            comment_id = str(item.get("commentId") or item.get("id") or f"{appid}:{idx}")
            records.append(
                {
                    "source_id": f"vivo:{appid}:{comment_id}",
                    "title": f"vivo 应用商店 / {app_name} / 用户评论",
                    "source_url": source_url,
                    "record_type": "review",
                    "query": str(target.get("query") or app_name),
                    "body": review_body,
                    "metrics": {
                        "rating": rating,
                        "app_id": appid,
                        "package": package,
                        "app_name": app_name,
                        "store_name": "vivo 应用商店",
                        "market_segment": "domestic-android",
                        "market_group": "国内应用市场",
                        "country": "cn",
                    },
                    "extra": {
                        "package": package,
                        "app_category": target.get("category", ""),
                        "source_parser": "vivo_h5_detail_appcomments",
                    },
                }
            )
            kept += 1
            if kept >= max_reviews_per_app:
                break
    return records, probes


def _url_with_params(url: str, params: dict[str, Any] | None = None) -> str:
    if not params:
        return url
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}{urllib.parse.urlencode(params)}"


def _oppo_headers(url: str) -> dict[str, str]:
    parsed = urllib.parse.urlparse(url)
    timestamp = str(int(time.time() * 1000))
    decoded_query = urllib.parse.unquote(parsed.query)
    sign_base = OPPO_SIGN_PREFIX + OPPO_OCS + timestamp + OPPO_ID + parsed.path + decoded_query
    sign = hashlib.md5((sign_base + str(len(sign_base)) + OPPO_SIGN_SUFFIX).encode("utf-8")).hexdigest()
    return {
        "User-Agent": OPPO_MOBILE_UA,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "t": timestamp,
        "id": OPPO_ID,
        "oak": OPPO_OAK,
        "ocs": OPPO_OCS,
        "sign": sign,
    }


def _oppo_request_json(url: str, *, params: dict[str, Any] | None = None, timeout: int = 30) -> dict[str, Any]:
    full_url = _url_with_params(url, params)
    request = urllib.request.Request(full_url, headers=_oppo_headers(full_url))
    with urllib.request.urlopen(request, timeout=timeout) as response:
        text = response.read().decode("utf-8", "ignore")
    if not text:
        return {}
    return json.loads(text)


def _oppo_extract_apps(value: Any) -> list[dict[str, Any]]:
    apps: list[dict[str, Any]] = []
    if isinstance(value, dict):
        if value.get("appId") and value.get("pkgName"):
            apps.append(value)
        for child in value.values():
            apps.extend(_oppo_extract_apps(child))
    elif isinstance(value, list):
        for child in value:
            apps.extend(_oppo_extract_apps(child))
    return apps


def _oppo_load_h5_catalog(pause_seconds: float) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    catalog: list[dict[str, Any]] = []
    probes: list[dict[str, Any]] = []
    seen: set[str] = set()
    endpoints = [
        (OPPO_H5_INDEX, "home/store/index.json", [0, 1]),
        (OPPO_H5_REQUIRED, "home/store/required.json", [0, 1]),
    ]
    for endpoint, label, starts in endpoints:
        for start in starts:
            params = {"start": start, "size": 50}
            try:
                payload = _request_json(endpoint, params=params, timeout=20)
            except Exception as exc:
                probes.append({"store": "OPPO 软件商店", "endpoint": label, "start": start, "status": f"h5_catalog_failed: {exc}"})
                continue
            apps = _oppo_extract_apps(payload)
            for app in apps:
                key = str(app.get("pkgName") or app.get("appId") or "")
                if not key or key in seen:
                    continue
                seen.add(key)
                catalog.append(app)
            probes.append({"store": "OPPO 软件商店", "endpoint": label, "start": start, "status": "h5_catalog_ok", "apps_found": len(apps)})
            time.sleep(pause_seconds)
    return catalog, probes


def _oppo_detail_payload(appid: Any) -> dict[str, Any]:
    return _oppo_request_json(OPPO_DETAILS_APPS, params={"appIds": appid}, timeout=20)


def _oppo_detail_base(payload: dict[str, Any]) -> dict[str, Any]:
    apps = payload.get("apps")
    if not isinstance(apps, list) or not apps:
        return {}
    first = apps[0]
    if isinstance(first, dict) and isinstance(first.get("base"), dict):
        return first["base"]
    return first if isinstance(first, dict) else {}


def _oppo_find_app(target: dict[str, Any], catalog: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, str]:
    package = str(target.get("package") or "")
    for app in catalog:
        if str(app.get("pkgName") or "") == package:
            return app, "h5_catalog"
    appid = target.get("oppo_app_id") or DEFAULT_OPPO_APP_IDS.get(package)
    if not appid:
        return None, "no_appid"
    detail = _oppo_detail_payload(appid)
    base = _oppo_detail_base(detail)
    if str(base.get("pkgName") or "") == package:
        return base, "known_appid_detail_verified"
    return None, "known_appid_package_mismatch"


def _oppo_signed_search_probe(query: str) -> dict[str, Any]:
    payload = _oppo_request_json(
        OPPO_SEARCH,
        params={"size": 10, "searchType": 9, "start": 0, "inputWord": query},
        timeout=20,
    )
    apps = _oppo_extract_apps(payload)
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    total = payload.get("total", data.get("total", ""))
    return {
        "endpoint": "search/v1/search",
        "status": "signed_search_ok" if apps else "signed_search_no_results",
        "total": total,
        "result_count": len(apps),
    }


def collect_oppo_store(
    targets: list[dict[str, Any]],
    max_reviews_per_app: int,
    pause_seconds: float,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    records: list[dict[str, Any]] = []
    probes: list[dict[str, Any]] = []
    catalog, catalog_probes = _oppo_load_h5_catalog(pause_seconds)
    probes.extend(catalog_probes)
    for target in targets:
        if "oppo" not in _stores_for(target, "oppo"):
            continue
        query = str(target.get("query") or target.get("package") or "")
        package = str(target.get("package") or "")
        try:
            app, discovery_status = _oppo_find_app(target, catalog)
        except Exception as exc:
            probes.append({"store": "OPPO 软件商店", "query": query, "package": package, "status": f"appid_discovery_failed: {exc}"})
            print(f"oppo appid discovery failed for {package}: {exc}", file=sys.stderr)
            continue

        if not app:
            probe = {
                "store": "OPPO 软件商店",
                "query": query,
                "package": package,
                "appid_discovery_status": discovery_status,
                "status": discovery_status,
            }
            try:
                probe.update(_oppo_signed_search_probe(query))
            except Exception as exc:
                probe["endpoint"] = "search/v1/search"
                probe["status"] = f"{discovery_status}; signed_search_failed: {exc}"
            probes.append(probe)
            print(f"oppo no appid for {package}: {probe.get('status')}", file=sys.stderr)
            time.sleep(pause_seconds)
            continue

        appid = app.get("appId")
        if not appid:
            probes.append({"store": "OPPO 软件商店", "query": query, "package": package, "status": "missing_appid_after_match"})
            continue
        detail_url = _url_with_params(OPPO_DETAILS_APPS, {"appIds": appid})
        try:
            detail_payload = _oppo_detail_payload(appid)
            detail = _oppo_detail_base(detail_payload) or app
        except Exception as exc:
            probes.append({"store": "OPPO 软件商店", "query": query, "package": package, "app_id": appid, "status": f"detail_failed: {exc}"})
            detail = app
        app_name = str(detail.get("appName") or app.get("appName") or target.get("query") or package)
        probes.append(
            {
                "store": "OPPO 软件商店",
                "query": query,
                "package": package,
                "app_id": appid,
                "endpoint": "home/store index + detail/v4/apps",
                "status": f"appid_found:{discovery_status}",
            }
        )
        body = (
            f"OPPO 软件商店评分 {detail.get('grade', '')}，评分人数 {detail.get('gradeCount', '')}，"
            f"安装量 {detail.get('dlDesc', '') or detail.get('dlCount', '')}；版本 {detail.get('verName', '')}。"
        )
        records.append(
            {
                "source_id": f"oppo:{appid}:score",
                "title": f"OPPO 软件商店 / {app_name} / 评分页",
                "source_url": detail_url,
                "record_type": "metric",
                "query": query,
                "body": body,
                "metrics": {
                    "app_id": appid,
                    "package": package,
                    "app_name": app_name,
                    "store_name": "OPPO 软件商店",
                    "market_segment": "domestic-android",
                    "market_group": "国内应用市场",
                    "rating": detail.get("grade", ""),
                    "rating_count": detail.get("gradeCount", ""),
                    "downloads": detail.get("dlCount", ""),
                    "download_count_text": detail.get("dlDesc", ""),
                    "version": detail.get("verName", ""),
                    "version_code": detail.get("verCode", ""),
                    "developer": detail.get("developer", ""),
                },
                "extra": {
                    "package": package,
                    "app_category": target.get("category", ""),
                    "source_parser": "oppo_h5_catalog_detail_score",
                },
            }
        )

        comments_url = _url_with_params(OPPO_COMMENTS, {"appId": appid, "size": max_reviews_per_app, "start": 0, "token": -1, "type": "bad"})
        try:
            comments_payload = _oppo_request_json(
                OPPO_COMMENTS,
                params={"appId": appid, "size": max_reviews_per_app, "start": 0, "token": -1, "type": "bad"},
                timeout=20,
            )
        except Exception as exc:
            probes.append({"store": "OPPO 软件商店", "query": query, "package": package, "app_id": appid, "status": f"comments_failed: {exc}"})
            print(f"oppo comments failed for {package}: {exc}", file=sys.stderr)
            continue
        kept = 0
        for idx, item in enumerate(comments_payload.get("comments") or []):
            if not isinstance(item, dict):
                continue
            rating = _int_value(item.get("grade") or item.get("rating") or item.get("score"))
            review_body = str(item.get("content") or "").strip()
            if rating > 3 or rating <= 0 or not review_body:
                continue
            comment_id = str(item.get("id") or f"{appid}:{idx}")
            records.append(
                {
                    "source_id": f"oppo:{appid}:{comment_id}",
                    "title": f"OPPO 软件商店 / {app_name} / 用户评论",
                    "source_url": comments_url,
                    "record_type": "review",
                    "query": query,
                    "body": review_body,
                    "metrics": {
                        "rating": rating,
                        "app_id": appid,
                        "package": package,
                        "app_name": app_name,
                        "store_name": "OPPO 软件商店",
                        "market_segment": "domestic-android",
                        "market_group": "国内应用市场",
                        "country": "cn",
                        "updated": _timestamp_millis_to_iso(item.get("commentTime") or item.get("createTime")),
                        "version": item.get("versionName", ""),
                        "praise_num": item.get("praiseNum", ""),
                        "comment_region": item.get("commentRegion", ""),
                    },
                    "extra": {
                        "author": item.get("userNickName", ""),
                        "package": package,
                        "app_category": target.get("category", ""),
                        "source_parser": "oppo_comment_list_bad",
                    },
                }
            )
            kept += 1
            if kept >= max_reviews_per_app:
                break
        probes.append(
            {
                "store": "OPPO 软件商店",
                "query": query,
                "package": package,
                "app_id": appid,
                "endpoint": "common/v1/comment/list",
                "status": "comments_ok",
                "comments_returned": len(comments_payload.get("comments") or []),
                "low_star_kept": kept,
            }
        )
        time.sleep(pause_seconds)
    return records, probes


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect Google Play and domestic Android market evidence.")
    parser.add_argument("--output", required=True)
    parser.add_argument("--market", action="append", choices=["google-play", "myapp", "xiaomi", "huawei", "vivo", "oppo"], default=[])
    parser.add_argument("--target-query", action="append", default=[], help="Limit collection to approved App target query. Repeatable.")
    parser.add_argument("--max-reviews-per-app", type=int, default=20)
    parser.add_argument("--max-pages-per-app", type=int, default=30)
    parser.add_argument("--pause-seconds", type=float, default=0.2)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    markets = set(args.market or ["google-play", "myapp", "xiaomi", "huawei", "vivo", "oppo"])
    google_targets, domestic_targets, unresolved_stores = _targets()
    google_targets = _filter_targets_by_query(google_targets, args.target_query)
    domestic_targets = _filter_targets_by_query(domestic_targets, args.target_query)
    target_keywords = [target.get("query") for target in google_targets + domestic_targets]
    try:
        require_keyword_approval(
            ROOT,
            SCENARIO_ID,
            CHANNEL_ID,
            operation="collect Android market evidence",
            keywords=target_keywords,
        )
    except KeywordApprovalError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    generated_at = datetime.now(timezone.utc).isoformat()
    records: list[dict[str, Any]] = []
    probes: list[dict[str, Any]] = []
    if "google-play" in markets:
        records.extend(collect_google_play(google_targets, args.max_reviews_per_app, args.pause_seconds))
    if "myapp" in markets:
        records.extend(collect_myapp(domestic_targets, args.max_reviews_per_app, args.pause_seconds))
    if "xiaomi" in markets:
        records.extend(collect_xiaomi_metrics(domestic_targets, args.pause_seconds))
    if "huawei" in markets:
        huawei_records, huawei_probes = collect_huawei_appgallery(
            domestic_targets,
            args.max_reviews_per_app,
            args.pause_seconds,
            args.max_pages_per_app,
        )
        records.extend(huawei_records)
        probes.extend(huawei_probes)
    if "vivo" in markets:
        vivo_records, vivo_probes = collect_vivo_store(domestic_targets, args.max_reviews_per_app, args.pause_seconds)
        records.extend(vivo_records)
        probes.extend(vivo_probes)
    if "oppo" in markets:
        oppo_records, oppo_probes = collect_oppo_store(domestic_targets, args.max_reviews_per_app, args.pause_seconds)
        records.extend(oppo_records)
        probes.extend(oppo_probes)
    envelope = {
        "generatedAt": generated_at,
        "source": {
            "google_play": GOOGLE_PLAY_DETAILS,
            "myapp": MYAPP_REVIEW,
            "xiaomi": XIAOMI_DETAILS,
            "huawei_search": HUAWEI_SEARCH,
            "huawei_comments": HUAWEI_COMMENTS,
            "vivo_search": VIVO_SEARCH,
            "vivo_details": VIVO_DETAILS,
            "oppo_h5_index": OPPO_H5_INDEX,
            "oppo_h5_required": OPPO_H5_REQUIRED,
            "oppo_search": OPPO_SEARCH,
            "oppo_details": OPPO_DETAILS_APPS,
            "oppo_comments": OPPO_COMMENTS,
        },
        "meta": {
            "markets": sorted(markets),
            "google_play_targets": google_targets,
            "domestic_android_targets": domestic_targets,
            "domestic_unresolved_stores": unresolved_stores,
            "probes": probes,
            "max_reviews_per_app": args.max_reviews_per_app,
            "max_pages_per_app": args.max_pages_per_app,
        },
        "records": records,
    }
    output = Path(args.output)
    print(f"Wrote {len(records)} Android market records to {output}")
    return write_collection_output(output, envelope, channel="appstore/android-markets", fail_on_errors=False, fail_on_login_wall=False)


if __name__ == "__main__":
    raise SystemExit(main())
