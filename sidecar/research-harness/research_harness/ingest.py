from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from .approval import require_keyword_approval
from .models import RawRecord
from .storage import read_json, sha256_file, slug_time, utc_now, write_json


def _source_id_from_url(url: str, fallback: str) -> str:
    if "/explore/" in url:
        return url.split("/explore/", 1)[1].split("?", 1)[0].strip("/")
    return fallback


def _xhs_url(note_id: str, token: str = "") -> str:
    if not note_id:
        return ""
    base = f"https://www.xiaohongshu.com/explore/{note_id}"
    if token:
        return f"{base}?xsec_token={token}&xsec_source=pc_search"
    return base


def _normalize_generic_record(raw: dict[str, Any], captured_at: str) -> RawRecord:
    source_url = raw.get("source_url") or raw.get("url") or raw.get("link") or ""
    title = raw.get("title") or raw.get("display_title") or raw.get("name") or ""
    source_id = raw.get("source_id") or raw.get("id") or _source_id_from_url(source_url, title)
    body = raw.get("body") or raw.get("desc") or raw.get("content") or raw.get("quote") or ""
    comments = list(raw.get("comments") or [])
    metrics = dict(raw.get("metrics") or {})
    for key in ["liked", "likes", "like_count", "comments_count", "collects"]:
        if key in raw and key not in metrics:
            metrics[key] = raw[key]
    reserved_keys = {
        "source_id", "id", "title", "source_url", "url", "link", "body", "desc",
        "content", "quote", "comments", "metrics", "query", "word", "record_type",
        "parent_source_id", "comment_id", "commentId", "captured_at", "extra",
    }
    extra = dict(raw.get("extra") or {}) if isinstance(raw.get("extra"), dict) else {}
    extra.update({k: v for k, v in raw.items() if k not in reserved_keys})
    return RawRecord(
        source_id=str(source_id),
        title=str(title),
        source_url=str(source_url),
        record_type=str(raw.get("record_type") or "post"),
        parent_source_id=str(raw.get("parent_source_id") or ""),
        comment_id=str(raw.get("comment_id") or raw.get("commentId") or ""),
        query=str(raw.get("query") or raw.get("word") or ""),
        body=str(body),
        comments=comments,
        metrics=metrics,
        captured_at=str(raw.get("captured_at") or captured_at),
        extra=extra,
    )


def parse_input_records(input_path: Path, source_format: str) -> tuple[str, list[RawRecord]]:
    data = read_json(input_path)
    if isinstance(data, dict):
        collection_status = (data.get("meta") or {}).get("collection_status") or {}
        if collection_status.get("blocked"):
            label = collection_status.get("primary_issue_label") or collection_status.get("primary_issue_type") or "抓取异常"
            next_action = collection_status.get("next_action") or "修复抓取异常后重新采集。"
            raise RuntimeError(f"Collector output is blocked: {label}. {next_action}")
    captured_at = str(data.get("generatedAt") or data.get("captured_at") or utc_now()) if isinstance(data, dict) else utc_now()

    if source_format == "evidence-list":
        if isinstance(data, dict):
            raw_records = data.get("records") or data.get("evidence") or []
        else:
            raw_records = data
        return captured_at, [_normalize_generic_record(item, captured_at) for item in raw_records]

    if source_format == "xhs-search":
        records: list[RawRecord] = []
        for query, items in (data.get("results") or {}).items():
            for idx, item in enumerate(items or []):
                item = dict(item)
                item["query"] = query
                item["source_url"] = item.get("link", "")
                item["metrics"] = {"likes": item.get("liked", "")}
                item["source_id"] = item.get("id") or _source_id_from_url(item.get("link", ""), f"{query}-{idx}")
                item["record_type"] = "post"
                records.append(_normalize_generic_record(item, captured_at))
        return captured_at, records

    if source_format == "xhs-detail":
        records = []
        token_map = data.get("tokenMap") or {}
        for note_id, item in (data.get("results") or {}).items():
            if not isinstance(item, dict):
                continue
            raw = dict(item)
            if not (raw.get("title") or raw.get("desc") or raw.get("body") or raw.get("comments")):
                continue
            token = token_map.get(note_id, "")
            raw["source_id"] = note_id
            raw["source_url"] = raw.get("url") or _xhs_url(note_id, token)
            raw["query"] = raw.get("query") or raw.get("word") or raw.get("label") or ""
            raw["body"] = raw.get("body") or raw.get("desc") or ""
            raw["record_type"] = "post"
            raw["metrics"] = {
                "likes": raw.get("likes", ""),
                "collects": raw.get("collects", ""),
                "comments_count": raw.get("cmtCount", ""),
            }
            records.append(_normalize_generic_record(raw, captured_at))
        return captured_at, records

    if source_format == "xhs-comments":
        records = []
        for note in data.get("notes", []):
            note = dict(note)
            note["source_url"] = note.get("url", "")
            note["source_id"] = note.get("id") or _source_id_from_url(note.get("url", ""), note.get("title", ""))
            note["query"] = note.get("word") or note.get("query") or ""
            note["body"] = note.get("body") or note.get("desc") or ""
            note["metrics"] = {
                "comments_fetched": note.get("fetchedCount", len(note.get("comments", []))),
                "comment_pages": note.get("pageCount", ""),
            }
            records.append(_normalize_generic_record(note, captured_at))
        return captured_at, records

    raise ValueError(f"Unsupported input format: {source_format}")


def ingest_file(
    root: Path,
    scenario_id: str,
    channel: str,
    input_path: Path,
    source_format: str,
    run_id: str | None = None,
    *,
    batch_id: str | None = None,
    delta_keywords: list[str] | None = None,
) -> Path:
    captured_at, records = parse_input_records(input_path, source_format)
    require_keyword_approval(
        root,
        scenario_id,
        channel,
        operation=f"ingest `{channel}` evidence",
        keywords=(record.query for record in records),
    )
    run_id = run_id or f"{channel}-{slug_time()}"
    raw_dir = root / "data" / "raw" / scenario_id / channel
    raw_dir.mkdir(parents=True, exist_ok=True)
    copied_path = raw_dir / f"{run_id}.source.json"
    if input_path.resolve() != copied_path.resolve():
        shutil.copyfile(input_path, copied_path)
    envelope = {
        "run_id": run_id,
        "scenario_id": scenario_id,
        "channel": channel,
        "source_format": source_format,
        "captured_at": captured_at,
        "imported_at": utc_now(),
        "raw_source_path": str(copied_path),
        "raw_sha256": sha256_file(copied_path),
        "batch_id": batch_id or "",
        "is_delta_run": bool(batch_id),
        "delta_keywords": delta_keywords or [],
        "records": [record.to_json() for record in records],
    }
    out_path = raw_dir / f"{run_id}.raw.json"
    write_json(out_path, envelope)
    return out_path
