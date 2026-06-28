from __future__ import annotations

from collections import Counter
from pathlib import Path

from .approval import require_keyword_approval
from .storage import read_jsonl

REQUIRED_FIELDS = [
    "evidence_id",
    "scenario_id",
    "channel",
    "source_url",
    "quote",
    "signal_strength",
    "confidence",
    "primary_platform",
    "platform_confidence",
]


def audit_evidence(root: Path, scenario_id: str) -> tuple[Path, list[str]]:
    require_keyword_approval(root, scenario_id, operation="audit evidence")
    evidence_path = root / "data" / "normalized" / scenario_id / "evidence.jsonl"
    rows = read_jsonl(evidence_path)
    channel_queries: dict[str, set[str]] = {}
    for row in rows:
        channel = str(row.get("channel") or "").strip()
        if not channel:
            continue
        channel_queries.setdefault(channel, set()).add(str(row.get("query") or ""))
    for channel, queries in channel_queries.items():
        require_keyword_approval(root, scenario_id, channel, operation="audit evidence", keywords=queries)
    issues: list[str] = []
    ids = Counter(row.get("evidence_id") for row in rows)
    for evidence_id, count in ids.items():
        if count > 1:
            issues.append(f"Duplicate evidence_id: {evidence_id} ({count})")
    for idx, row in enumerate(rows, start=1):
        for field in REQUIRED_FIELDS:
            if row.get(field) in ("", None, []):
                issues.append(f"Row {idx} missing required field: {field}")
        has_metric_signal = any(v not in ("", None, 0, "0") for v in (row.get("metrics") or {}).values())
        is_comment = row.get("record_type") == "comment" and row.get("comment_id")
        if row.get("confidence") == "A" and not row.get("comment_signal") and row.get("comments_count", 0) == 0 and not has_metric_signal and not is_comment:
            issues.append(f"Row {idx} marked A without comment or metric signal: {row.get('evidence_id')}")
    out_path = root / "analysis" / scenario_id / "audit.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# Audit: {scenario_id}",
        "",
        f"- Evidence rows: {len(rows)}",
        f"- Issues: {len(issues)}",
        "",
    ]
    if issues:
        lines.append("## Issues")
        lines.extend(f"- {issue}" for issue in issues)
    else:
        lines.append("No issues found.")
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return out_path, issues
