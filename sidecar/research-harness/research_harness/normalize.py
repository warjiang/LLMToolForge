from __future__ import annotations

from pathlib import Path
from typing import Any
import urllib.parse

from .approval import KeywordApprovalError, require_keyword_approval
from .infer import (
    infer_confidence,
    infer_dimension,
    infer_evidence_role,
    infer_interpretation,
    infer_next_step,
    infer_platform,
    infer_persona,
    infer_signal_strength,
    infer_source_quality,
    infer_validation_targets,
    is_noise,
    summarize_comments,
)
from .models import Evidence
from .storage import read_json, read_jsonl, stable_id, write_jsonl


def _quote(record: dict) -> str:
    body = str(record.get("body") or "").strip()
    if body:
        return body[:600]
    return str(record.get("title") or "").strip()[:600]


def _comment_content(comment: dict[str, Any]) -> str:
    return str(comment.get("content") or comment.get("c") or "").strip()


def _comment_id(comment: dict[str, Any], idx: int) -> str:
    return str(comment.get("comment_id") or comment.get("commentId") or comment.get("id") or "")


def _comment_key(comment: dict[str, Any], idx: int) -> str:
    return _comment_id(comment, idx) or _comment_content(comment)


def _comment_record(parent: dict[str, Any], comment: dict[str, Any], idx: int) -> dict[str, Any]:
    comment_id = _comment_id(comment, idx)
    source_comment_id = comment_id or f"comment-{idx}"
    metrics = {
        "like": comment.get("like", ""),
        "sub_comment_count": comment.get("subCommentCount", comment.get("sub_comment_count", "")),
    }
    content = _comment_content(comment)
    return {
        "source_id": f"{parent.get('source_id', '')}:{source_comment_id}",
        "parent_source_id": str(parent.get("source_id", "")),
        "comment_id": comment_id,
        "record_type": "comment",
        "title": str(parent.get("title", "")),
        "source_url": str(comment.get("source_url") or comment.get("url") or comment.get("link") or parent.get("source_url", "")),
        "captured_at": str(parent.get("captured_at", "")),
        "query": str(parent.get("query", "")),
        "body": content,
        "comments": [],
        "metrics": {k: v for k, v in metrics.items() if v not in ("", None)},
        "extra": {
            "nickname": comment.get("nickname", comment.get("u", "")),
            "ip": comment.get("ip", ""),
            "tags": comment.get("tags", []),
        },
    }


def _build_evidence(run: dict[str, Any], record: dict[str, Any]) -> Evidence:
    record_type = str(record.get("record_type") or "post")
    platform = infer_platform(record)
    evidence_id = "ev_" + stable_id(
        run["scenario_id"],
        run["channel"],
        record_type,
        str(record.get("source_id", "")),
        str(record.get("comment_id", "")),
        str(record.get("title", "")),
    )
    return Evidence(
        evidence_id=evidence_id,
        scenario_id=run["scenario_id"],
        channel=run["channel"],
        record_type=record_type,
        source_id=str(record.get("source_id", "")),
        parent_source_id=str(record.get("parent_source_id", "")),
        comment_id=str(record.get("comment_id", "")),
        source_url=str(record.get("source_url", "")),
        captured_at=str(record.get("captured_at") or run.get("captured_at", "")),
        query=str(record.get("query", "")),
        title=str(record.get("title", "")),
        quote=_quote(record),
        comment_signal=summarize_comments(list(record.get("comments") or [])),
        comments_count=len(record.get("comments") or []),
        metrics=dict(record.get("metrics") or {}),
        pain_dimension=infer_dimension(record),
        persona=infer_persona(record),
        signal_strength=infer_signal_strength(record),
        confidence=infer_confidence(record),
        evidence_role=infer_evidence_role(record),
        validation_targets=infer_validation_targets(record),
        source_quality=infer_source_quality(record),
        interpretation=infer_interpretation(record),
        next_step=infer_next_step(record),
        noise=is_noise(record),
        tags=[],
        primary_platform=str(platform["primary_platform"]),
        platform_confidence=str(platform["platform_confidence"]),
        platform_confidence_score=int(platform["platform_confidence_score"]),
        platform_reason=str(platform["platform_reason"]),
        secondary_platforms=list(platform["secondary_platforms"]),
        raw_run_id=run["run_id"],
    )


def _better_source_url(current: str, incoming: str) -> str:
    if not current:
        return incoming
    if "xsec_token=" not in current and "xsec_token=" in incoming:
        return incoming
    return current


def _merge_comments(existing: list[dict[str, Any]], incoming: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen = {_comment_key(comment, idx) for idx, comment in enumerate(existing, start=1) if isinstance(comment, dict)}
    merged = list(existing)
    for idx, comment in enumerate(incoming, start=1):
        if not isinstance(comment, dict) or not _comment_content(comment):
            continue
        key = _comment_key(comment, idx)
        if key in seen:
            continue
        seen.add(key)
        merged.append(comment)
    return merged


TRACKING_QUERY_PREFIXES = ("utm_",)
TRACKING_QUERY_KEYS = {
    "spm",
    "from",
    "source",
    "share_from_user_hidden",
    "xsec_source",
    "timestamp",
    "share_id",
    "share_channel",
}


def _canonical_url(value: object) -> str:
    url = str(value or "").strip()
    if not url:
        return ""
    parsed = urllib.parse.urlparse(url)
    scheme = parsed.scheme.lower() or "https"
    netloc = parsed.netloc.lower()
    path = parsed.path.rstrip("/") or parsed.path
    query_items = []
    for key, item_value in urllib.parse.parse_qsl(parsed.query, keep_blank_values=False):
        lowered = key.lower()
        if lowered in TRACKING_QUERY_KEYS or any(lowered.startswith(prefix) for prefix in TRACKING_QUERY_PREFIXES):
            continue
        if lowered == "xsec_token":
            continue
        query_items.append((key, item_value))
    query = urllib.parse.urlencode(query_items)
    return urllib.parse.urlunparse((scheme, netloc, path, "", query, ""))


def _xiaohongshu_note_id(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if "xiaohongshu.com" not in parsed.netloc:
        return ""
    parts = [part for part in parsed.path.split("/") if part]
    if "explore" in parts:
        idx = parts.index("explore")
        if idx + 1 < len(parts):
            return parts[idx + 1]
    return ""


def _post_source_key(run: dict[str, Any], record: dict[str, Any]) -> str:
    channel = str(run.get("channel") or "")
    source_id = str(record.get("source_id") or "").strip()
    canonical_url = _canonical_url(record.get("source_url"))
    if channel == "xiaohongshu":
        note_id = source_id or _xiaohongshu_note_id(canonical_url)
        if note_id:
            return f"xhs:{note_id}"
    if channel in {"reddit", "v2ex", "appstore"} and source_id:
        return f"{channel}:{source_id}"
    if canonical_url:
        return f"url:{canonical_url}"
    if source_id:
        return f"{channel}:{source_id}"
    return f"title:{str(record.get('title') or '').strip()}"


def _merge_record(base: dict[str, Any], incoming: dict[str, Any], run: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    run_ids = list(merged.get("_raw_run_ids") or [])
    if run.get("run_id") not in run_ids:
        run_ids.append(run.get("run_id"))
    merged["_raw_run_ids"] = run_ids
    for field in ["source_id", "title", "captured_at"]:
        if not merged.get(field) and incoming.get(field):
            merged[field] = incoming[field]
    merged["source_url"] = _better_source_url(str(merged.get("source_url", "")), str(incoming.get("source_url", "")))
    incoming_query = str(incoming.get("query", ""))
    if incoming_query:
        if not merged.get("query") or run.get("source_format") == "xhs-search":
            merged["query"] = incoming_query
    if len(str(incoming.get("body", ""))) > len(str(merged.get("body", ""))):
        merged["body"] = incoming.get("body", "")
    metrics = dict(merged.get("metrics") or {})
    for key, value in (incoming.get("metrics") or {}).items():
        if value not in ("", None, 0, "0"):
            metrics[key] = value
    merged["metrics"] = metrics
    merged["comments"] = _merge_comments(list(merged.get("comments") or []), list(incoming.get("comments") or []))
    return merged


def _merged_records(raw_files: list[Path]) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    merged: dict[tuple[str, str, str], tuple[dict[str, Any], dict[str, Any]]] = {}
    direct: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for raw_file in raw_files:
        run = read_json(raw_file)
        for record in run.get("records", []):
            record_type = str(record.get("record_type") or "post")
            if record_type != "post":
                direct.append((run, record))
                continue
            source_key = _post_source_key(run, record)
            key = (run["scenario_id"], run["channel"], source_key)
            if key not in merged:
                initial = dict(record)
                initial["_raw_run_ids"] = [run.get("run_id")]
                merged[key] = (run, initial)
            else:
                base_run, base_record = merged[key]
                merged[key] = (base_run, _merge_record(base_record, record, run))
    records = []
    for run, record in merged.values():
        run_ids = list(record.get("_raw_run_ids") or [run.get("run_id")])
        merged_run = dict(run)
        merged_run["run_id"] = ",".join(run_id for run_id in run_ids if run_id)
        records.append((merged_run, record))
    records.extend(direct)
    return records


def _raw_channel_queries(raw_files: list[Path]) -> dict[str, set[str]]:
    channel_queries: dict[str, set[str]] = {}
    for raw_file in raw_files:
        run = read_json(raw_file)
        channel = str(run.get("channel") or "").strip()
        if not channel:
            continue
        queries = channel_queries.setdefault(channel, set())
        for record in run.get("records") or []:
            if isinstance(record, dict) and record.get("query"):
                queries.add(str(record.get("query")))
    return channel_queries


def _raw_files_for_batch(raw_files: list[Path], batch_id: str) -> list[Path]:
    selected: list[Path] = []
    for raw_file in raw_files:
        run = read_json(raw_file)
        if str(run.get("batch_id") or "") == batch_id:
            selected.append(raw_file)
    return selected


def _run_ids_for_raw_files(raw_files: list[Path]) -> set[str]:
    run_ids: set[str] = set()
    for raw_file in raw_files:
        run_id = str(read_json(raw_file).get("run_id") or "").strip()
        if run_id:
            run_ids.add(run_id)
    return run_ids


def _row_run_ids(row: dict[str, Any]) -> set[str]:
    return {item.strip() for item in str(row.get("raw_run_id") or "").split(",") if item.strip()}


def _is_row_keyword_approved(root: Path, scenario_id: str, row: dict[str, Any]) -> bool:
    query = str(row.get("query") or "").strip()
    channel = str(row.get("channel") or "").strip()
    if not query or not channel:
        return True
    try:
        require_keyword_approval(root, scenario_id, channel, operation="merge normalized evidence", keywords=[query])
    except KeywordApprovalError:
        return False
    return True


def _merge_raw_run_ids(*values: str) -> str:
    run_ids: list[str] = []
    seen: set[str] = set()
    for value in values:
        for run_id in str(value or "").split(","):
            run_id = run_id.strip()
            if not run_id or run_id in seen:
                continue
            seen.add(run_id)
            run_ids.append(run_id)
    return ",".join(run_ids)


def _merge_existing_with_batch_rows(
    root: Path,
    scenario_id: str,
    out_path: Path,
    batch_rows: list[dict[str, Any]],
    batch_run_ids: set[str],
) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    by_id: dict[str, int] = {}
    for row in read_jsonl(out_path):
        if _row_run_ids(row) & batch_run_ids:
            continue
        if not _is_row_keyword_approved(root, scenario_id, row):
            continue
        by_id[str(row.get("evidence_id") or "")] = len(merged)
        merged.append(row)

    for row in batch_rows:
        evidence_id = str(row.get("evidence_id") or "")
        if evidence_id and evidence_id in by_id:
            existing = dict(merged[by_id[evidence_id]])
            incoming = dict(row)
            incoming["raw_run_id"] = _merge_raw_run_ids(existing.get("raw_run_id", ""), incoming.get("raw_run_id", ""))
            merged[by_id[evidence_id]] = incoming
            continue
        if evidence_id:
            by_id[evidence_id] = len(merged)
        merged.append(row)
    return merged


def normalize_scenario(root: Path, scenario_id: str, channel: str | None = None, batch_id: str | None = None) -> Path:
    require_keyword_approval(root, scenario_id, channel, operation="normalize evidence")
    raw_base = root / "data" / "raw" / scenario_id
    if not raw_base.exists():
        raise FileNotFoundError(f"No raw data found for scenario: {scenario_id}")
    raw_files = sorted(raw_base.glob(f"{channel}/*.raw.json" if channel else "*/*.raw.json"))
    if batch_id:
        raw_files = _raw_files_for_batch(raw_files, batch_id)
        if not raw_files:
            raise FileNotFoundError(f"No raw data found for batch: {batch_id}")
    for raw_channel, queries in _raw_channel_queries(raw_files).items():
        require_keyword_approval(
            root,
            scenario_id,
            raw_channel,
            operation="normalize evidence",
            keywords=queries,
        )
    evidence_rows: list[dict] = []
    seen: set[str] = set()
    for run, record in _merged_records(raw_files):
        evidence = _build_evidence(run, record)
        if evidence.evidence_id not in seen:
            seen.add(evidence.evidence_id)
            evidence_rows.append(evidence.to_json())

        for idx, comment in enumerate(record.get("comments") or [], start=1):
            if not isinstance(comment, dict) or not _comment_content(comment):
                continue
            comment_evidence = _build_evidence(run, _comment_record(record, comment, idx))
            if comment_evidence.evidence_id in seen:
                continue
            seen.add(comment_evidence.evidence_id)
            evidence_rows.append(comment_evidence.to_json())
    out_path = root / "data" / "normalized" / scenario_id / "evidence.jsonl"
    if batch_id:
        evidence_rows = _merge_existing_with_batch_rows(
            root,
            scenario_id,
            out_path,
            evidence_rows,
            _run_ids_for_raw_files(raw_files),
        )
    write_jsonl(out_path, evidence_rows)
    return out_path
