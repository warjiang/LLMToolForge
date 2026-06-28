#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
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

CHANNELS = {
    "5118-index": {
        "name": "5118指数",
        "source_url": "https://www.5118.com",
        "browser_strategy": "打开 5118 指数/关键词页，用已登录 Chrome 搜索关键词，优先抓 XHR JSON，其次读可见表格/下载结果。",
        "default_keywords": ["微信待办", "聊天记录总结", "自动提取待办", "会议纪要", "待办事项"],
    },
    "oceanengine-index": {
        "name": "巨量算数",
        "source_url": "https://trendinsight.oceanengine.com",
        "browser_strategy": "打开巨量算数趋势洞察页，用已登录 Chrome 查询关键词，优先抓趋势/指数 XHR，其次读页面图表数据或下载结果。",
        "default_keywords": ["微信待办", "AI会议纪要", "聊天记录总结", "效率工具", "待办清单"],
    },
    "douyin-index": {
        "name": "抖音指数",
        "source_url": "https://www.douyin.com",
        "browser_strategy": "打开抖音指数/搜索指数入口，用已登录 Chrome 查询关键词，优先抓页面 XHR，其次读可见指数卡片。",
        "default_keywords": ["微信待办", "群消息太多", "AI会议纪要", "聊天记录总结", "效率工具"],
    },
    "wechat-index": {
        "name": "微信指数",
        "source_url": "https://index.weixin.qq.com",
        "browser_strategy": "打开微信指数入口，用已登录 Chrome/微信环境查询关键词，优先抓 XHR 或页面展示的指数值，必要时暂停等待扫码/验证。",
        "default_keywords": ["微信待办", "微信群待办", "群消息太多", "聊天记录总结", "客户微信跟进"],
    },
}

FIELD_ALIASES = {
    "keyword": ["keyword", "query", "word", "term", "关键词", "词", "搜索词", "指数词"],
    "index_value": ["index", "index_value", "value", "搜索指数", "指数", "热度", "搜索量", "平均指数", "日均值", "整体指数", "综合指数"],
    "date": ["date", "day", "日期", "时间"],
    "period": ["period", "range", "date_range", "时间范围", "统计周期", "周期"],
    "start_date": ["start_date", "start", "开始日期", "开始时间"],
    "end_date": ["end_date", "end", "结束日期", "结束时间"],
    "source_url": ["source_url", "url", "link", "链接", "来源链接"],
    "rank": ["rank", "排名"],
    "yoy": ["yoy", "同比"],
    "mom": ["mom", "qoq", "环比"],
}


def _load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _unique_terms(values: list[object]) -> list[str]:
    seen: set[str] = set()
    terms: list[str] = []
    for value in values:
        text = str(value or "").strip()
        key = " ".join(text.split()).casefold()
        if not key or key in seen:
            continue
        seen.add(key)
        terms.append(text)
    return terms


def load_default_keywords(channel: str) -> list[str]:
    channel_config = _load_json(ROOT / "channels" / f"{channel}.json")
    matrix = _load_json(ROOT / "keyword_matrices" / f"{SCENARIO_ID}.json")
    keywords = (
        channel_config.get("crawl_plan", {}).get("keywords")
        or matrix.get("channel_keywords", {}).get(channel)
        or CHANNELS[channel]["default_keywords"]
    )
    return [str(keyword) for keyword in keywords]


def _norm_key(value: object) -> str:
    return str(value or "").strip().casefold().replace(" ", "").replace("_", "").replace("-", "")


def _pick(row: dict[str, Any], field: str) -> Any:
    aliases = {_norm_key(alias) for alias in FIELD_ALIASES[field]}
    for key, value in row.items():
        if _norm_key(key) in aliases and value not in ("", None):
            return value
    return ""


def _clean_number(value: Any) -> Any:
    text = str(value or "").strip()
    if not text:
        return ""
    normalized = text.replace(",", "").replace("，", "")
    try:
        number = float(normalized)
    except ValueError:
        return text
    if number.is_integer():
        return int(number)
    return number


def _clean_metric_value(value: Any) -> Any:
    text = str(value or "").strip()
    if not text or text == "-":
        return ""
    return _clean_number(text)


def _extract_rows(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if not isinstance(data, dict):
        return []
    for key in ["records", "rows", "data", "result", "results", "list", "items"]:
        value = data.get(key)
        rows = _extract_rows(value)
        if rows:
            return rows
    for value in data.values():
        rows = _extract_rows(value)
        if rows:
            return rows
    return []


def _read_export_rows(path: Path) -> list[dict[str, Any]]:
    if path.suffix.lower() == ".csv":
        with path.open(newline="", encoding="utf-8-sig") as handle:
            return [dict(row) for row in csv.DictReader(handle)]
    try:
        return _extract_rows(json.loads(path.read_text(encoding="utf-8")))
    except json.JSONDecodeError:
        with path.open(newline="", encoding="utf-8-sig") as handle:
            return [dict(row) for row in csv.DictReader(handle)]


def _slug(text: object) -> str:
    return urllib.parse.quote(str(text or "").strip(), safe="")


def _row_hash(row: dict[str, Any]) -> str:
    payload = json.dumps(row, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:10]


def _record_body(channel_name: str, keyword: str, index_value: Any, period: str, date: str) -> str:
    bits = [
        f"指数渠道={channel_name}",
        f"关键词={keyword}",
    ]
    if period:
        bits.append(f"统计周期={period}")
    if date:
        bits.append(f"日期={date}")
    bits.append(f"指数值={index_value}")
    bits.append("用途=仅用于需求规模、搜索/内容触达词校准，不单独证明痛点强度")
    return "；".join(bits)


def _metric_body(channel_name: str, keyword: str, metrics: dict[str, Any]) -> str:
    labels = {
        "related_long_tail_total": "相关长尾词",
        "indexed_word_count": "有指数词",
        "bid_company_count": "竞价公司数量",
        "long_tail_count": "长尾词数量",
        "traffic_index": "流量指数",
        "mobile_index": "移动指数",
        "index_360": "360指数",
        "pc_daily_search": "PC日检索量",
        "mobile_daily_search": "移动日检索量",
        "bid_price": "竞价价格",
        "toutiao_index": "头条指数",
        "douyin_index": "抖音指数",
        "kuaishou_index": "快手指数",
        "weibo_index": "微博指数",
    }
    bits = [f"指数渠道={channel_name}", f"关键词={keyword}"]
    for key, label in labels.items():
        if metrics.get(key) not in ("", None):
            bits.append(f"{label}={metrics[key]}")
    bits.append("用途=仅用于需求规模、搜索/内容触达词校准，不单独证明痛点强度")
    return "；".join(bits)


def build_records(
    *,
    channel: str,
    rows: list[dict[str, Any]],
    source_file: Path | str,
    keywords: list[str],
    max_total_records: int,
    source_type: str = "export_fallback",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    channel_info = CHANNELS[channel]
    keyword_filter = {" ".join(keyword.split()).casefold() for keyword in keywords if keyword.strip()}
    records: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    for idx, row in enumerate(rows, start=1):
        keyword = str(_pick(row, "keyword") or "").strip()
        if not keyword and len(keyword_filter) == 1:
            keyword = keywords[0]
        normalized_keyword = " ".join(keyword.split()).casefold()
        if keyword_filter and normalized_keyword and normalized_keyword not in keyword_filter:
            continue
        raw_index_value = _pick(row, "index_value")
        index_value = _clean_number(raw_index_value)
        if not keyword or index_value in ("", None):
            warnings.append({"row": idx, "warning": "missing keyword or index value"})
            continue
        date = str(_pick(row, "date") or "").strip()
        start_date = str(_pick(row, "start_date") or "").strip()
        end_date = str(_pick(row, "end_date") or "").strip()
        period = str(_pick(row, "period") or "").strip()
        if not period and (start_date or end_date):
            period = f"{start_date}..{end_date}".strip(".")
        source_url = str(_pick(row, "source_url") or channel_info["source_url"]).strip()
        metrics = {
            "index_channel": channel,
            "index_channel_name": channel_info["name"],
            "keyword": keyword,
            "index_value": index_value,
            "period": period,
            "date": date,
            "start_date": start_date,
            "end_date": end_date,
            "rank": _clean_number(_pick(row, "rank")),
            "yoy": _pick(row, "yoy"),
            "mom": _pick(row, "mom"),
            "source_type": source_type,
        }
        metrics = {key: value for key, value in metrics.items() if value not in ("", None)}
        period_key = period or date or f"row-{idx}"
        records.append(
            {
                "source_id": f"{channel}:{_slug(keyword)}:{_slug(period_key)}:{_row_hash(row)}",
                "title": f"{channel_info['name']}：{keyword}",
                "source_url": source_url,
                "record_type": "metric",
                "query": keyword,
                "body": _record_body(channel_info["name"], keyword, index_value, period, date),
                "comments": [],
                "metrics": metrics,
                "extra": {
                    "requires_login": True,
                    "source_file": str(source_file),
                    "raw_row": row,
                    "note": "指数数据只用于规模和触达词校准，不能替代社区/评论痛点证据。",
                },
            }
        )
        if len(records) >= max_total_records:
            break
    return records, warnings


_HEADER_MAP_5118 = {
    "关键词": "keyword",
    "竞价公司数量": "bid_company_count",
    "长尾词数量": "long_tail_count",
    "流量指数": "traffic_index",
    "移动指数": "mobile_index",
    "360指数": "index_360",
    "pc日检索量": "pc_daily_search",
    "移动日检索量": "mobile_daily_search",
    "竞价价格": "bid_price",
    "头条指数": "toutiao_index",
    "抖音指数": "douyin_index",
    "快手指数": "kuaishou_index",
    "微博指数": "weibo_index",
}


def _normalize_header(value: Any) -> str:
    return re.sub(r"\s+", "", str(value or "")).strip().lower()


def _browser_5118_script(keywords: list[str], max_total_records: int) -> str:
    payload = {
        "channel": "5118-index",
        "channel_name": CHANNELS["5118-index"]["name"],
        "target_url": "https://www.5118.com/ci",
        "keywords": keywords,
        "max_total_records": max_total_records,
    }
    payload_json = json.dumps(payload, ensure_ascii=False)
    return f"""
import json
probe = {payload_json}
probe["keyword_attempts"] = []
try:
    for keyword in probe.get("keywords", []):
        attempt = {{"keyword": keyword, "rows": []}}
        try:
            new_tab(probe["target_url"])
            wait_for_load()
            wait(1.5)
            input_result = js(\"\"\"
const keyword = %s;
const candidates = Array.from(document.querySelectorAll('input.input, input[placeholder*="搜索关键词"], input[placeholder*="关键词"], input[type=search], input[type=text], input:not([type])'));
const visible = (el) => {{
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return rect.width > 80 && rect.height > 15 && style.display !== 'none' && style.visibility !== 'hidden';
}};
const input = candidates.find(visible);
if (!input) return {{ok:false, reason:'no 5118 keyword input'}};
input.focus();
const setter = Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set;
setter.call(input, keyword);
input.dispatchEvent(new Event('input', {{bubbles:true}}));
input.dispatchEvent(new Event('change', {{bubbles:true}}));
return {{ok:true, placeholder: input.getAttribute('placeholder') || '', cls: input.className || ''}};
\"\"\" % json.dumps(keyword, ensure_ascii=False))
            attempt["input_result"] = input_result
            if input_result and input_result.get("ok"):
                pressed = False
                try:
                    press_key("Enter")
                    pressed = True
                except Exception as exc:
                    attempt["press_error"] = str(exc)
                if not pressed:
                    js("const btn=document.querySelector('button.btn, .btn, button'); if(btn) btn.click();")
                wait(5)
            try:
                attempt["current_url"] = js("location.href")
                attempt["title"] = js("document.title")
                attempt["visible_text"] = js("document.body ? document.body.innerText.slice(0, 12000) : ''")
                attempt["rows"] = js("Array.from(document.querySelectorAll('table tr')).slice(0, %d).map(tr => Array.from(tr.cells || []).map(td => td.innerText.trim()))" % max(20, int(probe.get("max_total_records") or 200) + 5))
            except Exception as exc:
                attempt["dom_error"] = str(exc)
        except Exception as exc:
            attempt["error"] = str(exc)
        probe["keyword_attempts"].append(attempt)
    try:
        probe["page_info"] = page_info()
    except Exception as exc:
        probe["page_info_error"] = str(exc)
    probe["status"] = "browser_probe_completed"
except Exception as exc:
    probe["status"] = "browser_probe_failed"
    probe["error"] = str(exc)
print("SEARCH_INDEX_PROBE_JSON=" + json.dumps(probe, ensure_ascii=False))
"""


def _parse_5118_attempt(
    *,
    attempt: dict[str, Any],
    max_total_records: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    channel = "5118-index"
    channel_info = CHANNELS[channel]
    keyword = str(attempt.get("keyword") or "").strip()
    source_url = str(attempt.get("current_url") or channel_info["source_url"]).strip()
    title = str(attempt.get("title") or "").strip()
    visible_text = str(attempt.get("visible_text") or "")
    records: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    summary_match = re.search(r"相关长尾词共找到\s*([\d,，]+)\s*条记录\s*\[\s*有指数[:：]?\s*([\d,，]+)\s*\]", visible_text)
    if summary_match:
        related_total = _clean_metric_value(summary_match.group(1))
        indexed_count = _clean_metric_value(summary_match.group(2))
        metrics = {
            "index_channel": channel,
            "index_channel_name": channel_info["name"],
            "keyword": keyword,
            "related_long_tail_total": related_total,
            "indexed_word_count": indexed_count,
            "source_type": "browser_harness_dom_5118_ci",
            "result_page_title": title,
        }
        metrics = {key: value for key, value in metrics.items() if value not in ("", None)}
        row_hash = _row_hash({"keyword": keyword, "source_url": source_url, "metrics": metrics})
        records.append(
            {
                "source_id": f"{channel}:{_slug(keyword)}:summary:{row_hash}",
                "title": f"5118长尾词概览：{keyword}",
                "source_url": source_url,
                "record_type": "metric",
                "query": keyword,
                "body": _metric_body(channel_info["name"], keyword, metrics),
                "comments": [],
                "metrics": metrics,
                "extra": {
                    "requires_login": True,
                    "source_file": "browser-harness-dom",
                    "note": "5118 页面实际展示的长尾词概览；若有指数词为 0，只能说明该词在 5118 当前页没有可见指数值。",
                },
            }
        )
    else:
        warnings.append({"keyword": keyword, "warning": "missing 5118 summary text"})

    table = attempt.get("rows") or []
    if not isinstance(table, list) or not table:
        warnings.append({"keyword": keyword, "warning": "missing 5118 result table"})
        return records, warnings

    header: list[str] = []
    data_rows: list[list[Any]] = []
    for raw_row in table:
        if not isinstance(raw_row, list):
            continue
        cells = [str(cell or "").strip() for cell in raw_row]
        normalized = [_normalize_header(cell) for cell in cells]
        if "关键词" in cells or "关键词" in normalized:
            header = cells
            continue
        if header and any(cells):
            data_rows.append(cells)

    if not header:
        warnings.append({"keyword": keyword, "warning": "missing 5118 table header"})
        return records, warnings

    field_names = [_HEADER_MAP_5118.get(_normalize_header(cell), _normalize_header(cell)) for cell in header]
    for idx, cells in enumerate(data_rows, start=1):
        row: dict[str, Any] = {}
        for pos, value in enumerate(cells):
            if pos >= len(field_names):
                continue
            key = field_names[pos]
            if not key:
                continue
            cleaned = _clean_metric_value(value)
            if cleaned not in ("", None):
                row[key] = cleaned
        row_keyword = str(row.get("keyword") or "").strip()
        if not row_keyword:
            continue
        metrics = {
            "index_channel": channel,
            "index_channel_name": channel_info["name"],
            "keyword": row_keyword,
            "seed_keyword": keyword,
            "source_type": "browser_harness_dom_5118_ci",
            "result_page_title": title,
        }
        for metric_key in [
            "bid_company_count",
            "long_tail_count",
            "traffic_index",
            "mobile_index",
            "index_360",
            "pc_daily_search",
            "mobile_daily_search",
            "bid_price",
            "toutiao_index",
            "douyin_index",
            "kuaishou_index",
            "weibo_index",
        ]:
            if row.get(metric_key) not in ("", None):
                metrics[metric_key] = row[metric_key]
        meaningful_metric_keys = {
            "bid_company_count",
            "long_tail_count",
            "traffic_index",
            "mobile_index",
            "index_360",
            "pc_daily_search",
            "mobile_daily_search",
            "bid_price",
            "toutiao_index",
            "douyin_index",
            "kuaishou_index",
            "weibo_index",
        }
        if not any(metrics.get(metric_key) not in ("", None) for metric_key in meaningful_metric_keys):
            continue
        if metrics.get("traffic_index") not in ("", None):
            metrics["index_value"] = metrics["traffic_index"]
        metrics = {key: value for key, value in metrics.items() if value not in ("", None)}
        row_hash = _row_hash({"seed": keyword, "row": row, "source_url": source_url})
        records.append(
            {
                "source_id": f"{channel}:{_slug(keyword)}:longtail:{_slug(row_keyword)}:{row_hash}",
                "title": f"5118长尾词：{row_keyword}",
                "source_url": source_url,
                "record_type": "metric",
                "query": keyword,
                "body": _metric_body(channel_info["name"], row_keyword, metrics),
                "comments": [],
                "metrics": metrics,
                "extra": {
                    "requires_login": True,
                    "source_file": "browser-harness-dom",
                    "raw_row": row,
                    "note": "5118 DOM 表格可见行；空白或 '-' 指标已省略，未补造指数值。",
                },
            }
        )
        if len(records) >= max_total_records:
            break
    return records, warnings


def records_from_5118_probe(
    probe: dict[str, Any],
    max_total_records: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    records: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    for attempt in probe.get("keyword_attempts") or []:
        if not isinstance(attempt, dict):
            continue
        attempt_records, attempt_warnings = _parse_5118_attempt(attempt=attempt, max_total_records=max_total_records - len(records))
        records.extend(attempt_records)
        warnings.extend(attempt_warnings)
        if len(records) >= max_total_records:
            break
    return records[:max_total_records], warnings


def _browser_creator_index_script(channel: str, keywords: list[str]) -> str:
    payload = {
        "channel": channel,
        "channel_name": CHANNELS[channel]["name"],
        "target_url": CHANNELS[channel]["source_url"],
        "keywords": keywords,
    }
    payload_json = json.dumps(payload, ensure_ascii=False)
    return f"""
import json
import urllib.parse
probe = {payload_json}
probe["keyword_attempts"] = []
try:
    for keyword in probe.get("keywords", []):
        attempt = {{"keyword": keyword}}
        try:
            url = "https://creator.douyin.com/creator-micro/creator-count/arithmetic-index/analysis?source=creator&keyword=" + urllib.parse.quote(keyword) + "&appName=aweme"
            new_tab(url)
            wait_for_load()
            wait(4)
            attempt["current_url"] = js("location.href")
            attempt["title"] = js("document.title")
            attempt["visible_text"] = js("document.body ? document.body.innerText.slice(0, 14000) : ''")
            attempt["has_keyword_input"] = js("!!Array.from(document.querySelectorAll('input')).find(i => (i.placeholder || '').includes('关键词'))")
        except Exception as exc:
            attempt["error"] = str(exc)
        probe["keyword_attempts"].append(attempt)
    try:
        probe["page_info"] = page_info()
    except Exception as exc:
        probe["page_info_error"] = str(exc)
    probe["status"] = "browser_probe_completed"
except Exception as exc:
    probe["status"] = "browser_probe_failed"
    probe["error"] = str(exc)
print("SEARCH_INDEX_PROBE_JSON=" + json.dumps(probe, ensure_ascii=False))
"""


def _build_index_metric_record(
    *,
    channel: str,
    keyword: str,
    source_url: str,
    title: str,
    metric_name: str,
    index_value: Any,
    yoy: str = "",
    mom: str = "",
    period: str = "",
    start_date: str = "",
    end_date: str = "",
    source_type: str,
    note: str,
) -> dict[str, Any]:
    channel_info = CHANNELS[channel]
    metrics = {
        "index_channel": channel,
        "index_channel_name": channel_info["name"],
        "keyword": keyword,
        "metric_name": metric_name,
        "index_value": index_value,
        "yoy": yoy,
        "mom": mom,
        "period": period,
        "start_date": start_date,
        "end_date": end_date,
        "source_type": source_type,
        "result_page_title": title,
    }
    metrics = {key: value for key, value in metrics.items() if value not in ("", None)}
    bits = [
        f"指数渠道={channel_info['name']}",
        f"关键词={keyword}",
        f"指标={metric_name}",
    ]
    if period:
        bits.append(f"统计周期={period}")
    if index_value not in ("", None):
        bits.append(f"平均值={index_value}")
    if yoy:
        bits.append(f"同比={yoy}")
    if mom:
        bits.append(f"环比={mom}")
    bits.append("用途=仅用于需求规模、搜索/内容触达词校准，不单独证明痛点强度")
    row_hash = _row_hash({"channel": channel, "keyword": keyword, "metric": metric_name, "metrics": metrics, "source_url": source_url})
    return {
        "source_id": f"{channel}:{_slug(keyword)}:{_slug(metric_name)}:{row_hash}",
        "title": f"{channel_info['name']}：{keyword} - {metric_name}",
        "source_url": source_url or channel_info["source_url"],
        "record_type": "metric",
        "query": keyword,
        "body": "；".join(bits),
        "comments": [],
        "metrics": metrics,
        "extra": {
            "requires_login": True,
            "source_file": "browser-harness-dom",
            "note": note,
        },
    }


def _parse_creator_index_attempt(
    *,
    channel: str,
    attempt: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    keyword = str(attempt.get("keyword") or "").strip()
    visible_text = str(attempt.get("visible_text") or "")
    source_url = str(attempt.get("current_url") or CHANNELS[channel]["source_url"]).strip()
    title = str(attempt.get("title") or "").strip()
    records: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    period = ""
    start_date = ""
    end_date = ""
    period_match = re.search(r"本周期[:：]\s*(\d{4}-\d{2}-\d{2})\s*[~～-]\s*(\d{4}-\d{2}-\d{2})", visible_text)
    if period_match:
        start_date, end_date = period_match.groups()
        period = f"{start_date}..{end_date}"

    metric_patterns = [
        ("关键词搜索指数", r"关键词搜索指数[\s\S]{0,260}?" + re.escape(keyword) + r"\s*同比\s*([+\-]?\d+(?:\.\d+)?%)\s*[｜|]\s*环比\s*([+\-]?\d+(?:\.\d+)?%)[\s\S]{0,80}?平均值\s*([\d,，]+)"),
        ("关键词综合指数", r"关键词综合指数[\s\S]{0,260}?" + re.escape(keyword) + r"\s*同比\s*([+\-]?\d+(?:\.\d+)?%)\s*[｜|]\s*环比\s*([+\-]?\d+(?:\.\d+)?%)[\s\S]{0,80}?平均值\s*([\d,，]+)"),
    ]
    seen: set[tuple[str, Any]] = set()
    for metric_name, pattern in metric_patterns:
        for match in re.finditer(pattern, visible_text):
            yoy, mom, raw_value = match.groups()
            index_value = _clean_metric_value(raw_value)
            key = (metric_name, index_value)
            if key in seen:
                continue
            seen.add(key)
            records.append(
                _build_index_metric_record(
                    channel=channel,
                    keyword=keyword,
                    source_url=source_url,
                    title=title,
                    metric_name=metric_name,
                    index_value=index_value,
                    yoy=yoy,
                    mom=mom,
                    period=period,
                    start_date=start_date,
                    end_date=end_date,
                    source_type="browser_harness_dom_douyin_creator_index",
                    note="巨量/抖音创作者中心指数页 DOM 可见指标；用于规模和触达词校准。",
                )
            )
    if not records:
        no_data = any(term in visible_text for term in ["暂无数据", "没有相关数据", "未找到", "数据不足", "暂未收录", "尚未收录"])
        warnings.append({"keyword": keyword, "warning": "no creator index metric parsed", "no_data_hint": no_data})
        if no_data:
            records.append(
                _build_index_metric_record(
                    channel=channel,
                    keyword=keyword,
                    source_url=source_url,
                    title=title,
                    metric_name="关键词指数无可见数据",
                    index_value="",
                    period=period,
                    start_date=start_date,
                    end_date=end_date,
                    source_type="browser_harness_dom_douyin_creator_index",
                    note="页面明确无可见指数数据；记录为关键词缺口，不补造数值。",
                )
            )
    return records, warnings


def records_from_creator_index_probe(
    *,
    channel: str,
    probe: dict[str, Any],
    max_total_records: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    records: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    for attempt in probe.get("keyword_attempts") or []:
        if not isinstance(attempt, dict):
            continue
        attempt_records, attempt_warnings = _parse_creator_index_attempt(channel=channel, attempt=attempt)
        records.extend(attempt_records)
        warnings.extend(attempt_warnings)
        if len(records) >= max_total_records:
            break
    return records[:max_total_records], warnings


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect or import search/index metrics as research evidence.")
    parser.add_argument("--channel", required=True, choices=sorted(CHANNELS), help="Index channel id.")
    parser.add_argument("--output", required=True, help="Output JSON path.")
    parser.add_argument("--input", default="", help="CSV/JSON fallback import path.")
    parser.add_argument("--keyword", action="append", default=[], help="Approved keyword filter. Repeatable.")
    parser.add_argument("--max-total-records", type=int, default=200)
    parser.add_argument(
        "--method",
        choices=["auto", "browser", "export"],
        default="auto",
        help="auto uses CSV/JSON when --input is present, otherwise browser-harness. export requires --input.",
    )
    parser.add_argument("--browser-command", default="browser-harness", help="Browser harness command.")
    parser.add_argument("--browser-timeout-seconds", type=int, default=90)
    parser.add_argument("--browser-keyword-limit", type=int, default=5, help="Max approved keywords to try in the generic browser pass.")
    return parser.parse_args(argv)


def _blocked_envelope(channel: str, keywords: list[str], generated_at: str, reason: str, input_path: str = "") -> dict[str, Any]:
    return {
        "generatedAt": generated_at,
        "source": {
            "channel": channel,
            "name": CHANNELS[channel]["name"],
            "target": CHANNELS[channel]["source_url"],
            "input": input_path,
        },
        "meta": {
            "keywords": keywords,
            "collector_method": "export_fallback",
            "requires_login_or_browser_access": True,
            "records_are_search_index_metrics": True,
            "errors": [
                {
                    "surface": channel,
                    "error": reason,
                }
            ],
            "note": "指数渠道由 research-harness 优先用 browser-harness 代采；CSV/JSON 只是失败后的 fallback，不编造指数值。",
        },
        "records": [],
    }


LOGIN_WALL_TERMS = [
    "扫码",
    "验证码",
    "安全验证",
    "安全校验",
    "访问太频繁",
    "请先登录",
    "登录后",
    "账号登录",
    "立即登录",
    "会员登录",
    "login required",
    "please login",
    "please sign in",
    "captcha",
    "verification",
]


def _browser_probe_script(channel: str, keywords: list[str]) -> str:
    target = CHANNELS[channel]["source_url"]
    payload = {
        "channel": channel,
        "channel_name": CHANNELS[channel]["name"],
        "target_url": target,
        "keywords": keywords,
        "strategy": CHANNELS[channel]["browser_strategy"],
    }
    payload_json = json.dumps(payload, ensure_ascii=False)
    return f"""
import json
probe = {payload_json}
try:
    network_enable_error = ""
    try:
        cdp("Network.enable")
        drain_events()
    except Exception as exc:
        network_enable_error = str(exc)
    new_tab(probe["target_url"])
    wait_for_load()
    wait(4)
    try:
        candidates = []
        def collect_network_candidates(stage):
            events = drain_events()
            for event in events:
                if event.get("method") != "Network.responseReceived":
                    continue
                params = event.get("params") or {{}}
                response = params.get("response") or {{}}
                url = response.get("url", "")
                mime = response.get("mimeType", "")
                lowered = (url + " " + mime).lower()
                if not any(token in lowered for token in ["json", "api", "index", "trend", "search", "keyword", "metric"]):
                    continue
                item = {{
                    "stage": stage,
                    "url": url,
                    "status": response.get("status"),
                    "mimeType": mime,
                    "requestId": params.get("requestId"),
                }}
                if len(candidates) < 12:
                    try:
                        body = cdp("Network.getResponseBody", session_id=event.get("session_id"), requestId=params.get("requestId"))
                        body_text = body.get("body", "")
                        item["body_text"] = body_text[:20000]
                        item["body_truncated"] = len(body_text) > 20000
                    except Exception as exc:
                        item["body_error"] = str(exc)
                candidates.append(item)
                if len(candidates) >= 30:
                    break
        collect_network_candidates("initial_load")
        probe["keyword_attempts"] = []
        for keyword in probe.get("keywords", []):
            attempt = {{"keyword": keyword}}
            try:
                result = js(\"\"\"
const keyword = %s;
const visible = (el) => {{
  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 20 && rect.height > 10;
}};
const inputs = Array.from(document.querySelectorAll('input[type=search], input[type=text], input:not([type]), textarea')).filter(visible);
const input = inputs[0];
if (!input) return {{ok:false, reason:'no visible search input'}};
input.focus();
const setter = Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set;
setter.call(input, keyword);
input.dispatchEvent(new Event('input', {{bubbles:true}}));
input.dispatchEvent(new Event('change', {{bubbles:true}}));
return {{ok:true, placeholder: input.getAttribute('placeholder') || '', name: input.getAttribute('name') || ''}};
\"\"\" % json.dumps(keyword, ensure_ascii=False))
                attempt["input_result"] = result
                if result and result.get("ok"):
                    press_key("Enter")
                    wait(3)
                    collect_network_candidates("keyword_search")
            except Exception as exc:
                attempt["error"] = str(exc)
            probe["keyword_attempts"].append(attempt)
            if len(candidates) >= 30:
                break
        probe["network_candidates"] = candidates
    except Exception as exc:
        probe["network_capture_error"] = str(exc)
    if network_enable_error:
        probe["network_enable_error"] = network_enable_error
    try:
        probe["page_info"] = page_info()
    except Exception as exc:
        probe["page_info_error"] = str(exc)
    try:
        probe["current_url"] = js("location.href")
        probe["title"] = js("document.title")
        probe["visible_text"] = js("document.body ? document.body.innerText.slice(0, 8000) : ''")
    except Exception as exc:
        probe["dom_error"] = str(exc)
    probe["status"] = "browser_probe_completed"
except Exception as exc:
    probe["status"] = "browser_probe_failed"
    probe["error"] = str(exc)
print("SEARCH_INDEX_PROBE_JSON=" + json.dumps(probe, ensure_ascii=False))
"""


def _extract_probe(stdout: str) -> dict[str, Any]:
    for line in reversed(stdout.splitlines()):
        if line.startswith("SEARCH_INDEX_PROBE_JSON="):
            try:
                data = json.loads(line.split("=", 1)[1])
            except json.JSONDecodeError:
                return {}
            return data if isinstance(data, dict) else {}
    return {}


def _keyword_from_url(url: str, keywords: list[str]) -> str:
    decoded = urllib.parse.unquote(str(url or "")).casefold()
    for keyword in keywords:
        text = " ".join(str(keyword or "").split())
        if text and text.casefold() in decoded:
            return text
    return ""


def records_from_browser_probe(
    *,
    channel: str,
    probe: dict[str, Any],
    keywords: list[str],
    max_total_records: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    for candidate in probe.get("network_candidates") or []:
        if not isinstance(candidate, dict):
            continue
        body_text = str(candidate.get("body_text") or "").strip()
        if not body_text:
            continue
        try:
            parsed = json.loads(body_text)
        except json.JSONDecodeError:
            continue
        candidate_rows = _extract_rows(parsed)
        if not candidate_rows:
            continue
        url = str(candidate.get("url") or "")
        keyword = _keyword_from_url(url, keywords)
        for row in candidate_rows:
            enriched = dict(row)
            enriched.setdefault("source_url", url or CHANNELS[channel]["source_url"])
            if keyword:
                enriched.setdefault("keyword", keyword)
                enriched.setdefault("关键词", keyword)
            rows.append(enriched)
            if len(rows) >= max_total_records:
                break
        if len(rows) >= max_total_records:
            break
    records, parse_warnings = build_records(
        channel=channel,
        rows=rows,
        source_file="browser-harness-network",
        keywords=keywords,
        max_total_records=max_total_records,
        source_type="browser_harness_xhr",
    )
    warnings.extend(parse_warnings)
    if rows and not records:
        warnings.append({
            "warning": "browser network JSON was captured but did not match generic keyword/index field aliases",
            "candidate_rows": len(rows),
        })
    return records, warnings


def run_browser_probe(args: argparse.Namespace, keywords: list[str]) -> dict[str, Any]:
    probe_keywords = keywords[: max(1, int(args.browser_keyword_limit or 1))]
    is_5118 = args.channel == "5118-index"
    is_creator_index = args.channel in {"oceanengine-index", "douyin-index"}
    if is_5118:
        script = _browser_5118_script(probe_keywords, args.max_total_records)
    elif is_creator_index:
        script = _browser_creator_index_script(args.channel, probe_keywords)
    else:
        script = _browser_probe_script(args.channel, probe_keywords)
    try:
        completed = subprocess.run(
            [args.browser_command, "-c", script],
            text=True,
            capture_output=True,
            timeout=args.browser_timeout_seconds,
            check=False,
        )
    except Exception as exc:
        return {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "source": {
                "channel": args.channel,
                "name": CHANNELS[args.channel]["name"],
                "target": CHANNELS[args.channel]["source_url"],
            },
            "meta": {
                "keywords": keywords,
                "probe_keywords": probe_keywords,
                "collector_method": "browser_harness",
                "actual_capture_method": "browser_harness_probe_failed",
                "requires_login_or_browser_access": True,
                "records_are_search_index_metrics": True,
                "errors": [{"surface": args.channel, "error": f"browser-harness 执行失败：{exc}"}],
                "note": "自动采集优先；此处没有导入部分结果。修复浏览器/登录/网络后重跑。",
            },
            "records": [],
        }
    probe = _extract_probe(completed.stdout)
    if not probe:
        probe = {
            "surface": args.channel,
            "status": "browser_probe_failed",
            "error": (completed.stderr or completed.stdout or "browser-harness did not return a parseable probe")[-1000:],
        }
    visible_text = " ".join(
        str(probe.get(key) or "") for key in ["title", "current_url", "visible_text", "page_info", "error"]
    ).lower()
    probe["surface"] = args.channel
    probe["capture_method"] = "browser_harness_xhr_dom_probe"
    probe["login_or_verification_wall"] = any(term.lower() in visible_text for term in LOGIN_WALL_TERMS)
    errors: list[dict[str, str]] = []
    if completed.returncode != 0:
        errors.append(
            {
                "surface": args.channel,
                "error": (completed.stderr or completed.stdout or f"browser-harness exited {completed.returncode}")[-1200:],
            }
        )
    if str(probe.get("current_url") or "").startswith("chrome-error://") or "ERR_NAME_NOT_RESOLVED" in visible_text.upper():
        errors.append(
            {
                "surface": args.channel,
                "error": f"Chrome network error while opening {CHANNELS[args.channel]['source_url']}: {str(probe.get('visible_text') or '')[:500]}",
            }
        )
    if is_5118:
        records, warnings = records_from_5118_probe(
            probe=probe,
            max_total_records=args.max_total_records,
        )
        actual_capture_method = "browser_harness_dom_5118_ci"
    elif is_creator_index:
        records, warnings = records_from_creator_index_probe(
            channel=args.channel,
            probe=probe,
            max_total_records=args.max_total_records,
        )
        actual_capture_method = "browser_harness_dom_douyin_creator_index"
    else:
        records, warnings = records_from_browser_probe(
            channel=args.channel,
            probe=probe,
            keywords=keywords,
            max_total_records=args.max_total_records,
        )
        actual_capture_method = "browser_harness_xhr_dom_probe"
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "channel": args.channel,
            "name": CHANNELS[args.channel]["name"],
            "target": CHANNELS[args.channel]["source_url"],
        },
        "meta": {
            "keywords": keywords,
            "probe_keywords": probe_keywords,
            "collector_method": "browser_harness",
            "actual_capture_method": actual_capture_method,
            "planned_capture_order": [
                "连接用户已登录 Chrome",
                "打开指数平台入口并查询关键词",
                "优先拦截 XHR/fetch JSON 中的指数/趋势值",
                "XHR 不可用时读取 DOM 表格/图表可见数据",
                "页面提供下载时用下载文件导入",
                "遇到登录、验证码、会员墙、网络异常或空结果时暂停并写诊断",
            ],
            "requires_login_or_browser_access": True,
            "records_are_search_index_metrics": True,
            "probes": [probe],
            "warnings": warnings[:50],
            "errors": errors,
            "note": "本次已进入浏览器自动采集路径。若诊断为空结果，说明需要在实际页面上补充站点专用 XHR/DOM 解析规则后重跑。",
        },
        "records": records,
    }


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    generated_at = datetime.now(timezone.utc).isoformat()
    keywords = args.keyword or load_default_keywords(args.channel)
    records: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    input_path = Path(args.input) if args.input else None
    method = "export" if input_path else ("browser" if args.method == "auto" else args.method)

    if method == "browser":
        try:
            require_keyword_approval(
                ROOT,
                SCENARIO_ID,
                args.channel,
                operation=f"collect {CHANNELS[args.channel]['name']} via browser harness",
                keywords=keywords,
            )
        except KeywordApprovalError as exc:
            print(str(exc), file=sys.stderr)
            return 2
        envelope = run_browser_probe(args, keywords)
        return write_collection_output(Path(args.output), envelope, channel=args.channel, fail_on_errors=True)

    if input_path:
        try:
            rows = _read_export_rows(input_path)
            records, warnings = build_records(
                channel=args.channel,
                rows=rows,
                source_file=input_path,
                keywords=keywords,
                max_total_records=args.max_total_records,
            )
        except Exception as exc:
            envelope = _blocked_envelope(
                args.channel,
                keywords,
                generated_at,
                f"导出文件解析失败，需要检查 CSV/JSON 格式后重试：{exc}",
                str(input_path),
            )
            return write_collection_output(Path(args.output), envelope, channel=args.channel)
    else:
        try:
            require_keyword_approval(
                ROOT,
                SCENARIO_ID,
                args.channel,
                operation=f"collect {CHANNELS[args.channel]['name']} index metrics from fallback export",
                keywords=keywords,
            )
        except KeywordApprovalError as exc:
            print(str(exc), file=sys.stderr)
            return 2
        envelope = _blocked_envelope(
            args.channel,
            keywords,
            generated_at,
            "已选择 export fallback，但未提供 --input；请改用默认 browser-harness 自动采集，或提供 CSV/JSON 兜底文件。",
        )
        return write_collection_output(Path(args.output), envelope, channel=args.channel)

    approval_keywords = _unique_terms(keywords + [record["query"] for record in records])
    try:
        require_keyword_approval(
            ROOT,
            SCENARIO_ID,
            args.channel,
            operation=f"collect {CHANNELS[args.channel]['name']} index metrics from fallback export",
            keywords=approval_keywords,
        )
    except KeywordApprovalError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    errors: list[dict[str, Any]] = []
    if not records:
        errors.append(
            {
                "surface": args.channel,
                "error": "导出文件未解析出可导入指数记录；请确认包含关键词和指数值列。",
            }
        )
    envelope = {
        "generatedAt": generated_at,
        "source": {
            "channel": args.channel,
            "name": CHANNELS[args.channel]["name"],
            "target": CHANNELS[args.channel]["source_url"],
            "input": str(input_path),
        },
        "meta": {
            "keywords": keywords,
            "collector_method": "export_fallback",
            "actual_capture_method": "csv_json_import",
            "requires_login_or_browser_access": True,
            "records_are_search_index_metrics": True,
            "source_type": "user_export",
            "warnings": warnings[:50],
            "errors": errors,
            "note": "指数数据只用于需求规模、趋势和触达词校准，不单独证明痛点强度。",
        },
        "records": records,
    }
    print(f"Wrote {len(records)} {CHANNELS[args.channel]['name']} metric records to {args.output}")
    return write_collection_output(Path(args.output), envelope, channel=args.channel)


if __name__ == "__main__":
    raise SystemExit(main())
