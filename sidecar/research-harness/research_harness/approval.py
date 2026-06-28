from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable

from .storage import read_json


APPROVED_STATUS = "approved"
KEYWORD_FIELD_NAMES = {"keyword", "keywords", "query", "queries", "term", "terms"}


class KeywordApprovalError(RuntimeError):
    """Raised when a workflow tries to use unapproved research keywords."""


def _read_required_json(path: Path, rel_path: str) -> dict[str, Any]:
    if not path.exists():
        raise KeywordApprovalError(f"Keyword approval required: missing `{rel_path}`.")
    try:
        data = read_json(path)
    except ValueError as exc:
        raise KeywordApprovalError(f"Keyword approval required: `{rel_path}` is not valid JSON.") from exc
    if not isinstance(data, dict):
        raise KeywordApprovalError(f"Keyword approval required: `{rel_path}` must be a JSON object.")
    return data


def _approval_issues(metadata: Any, rel_path: str, field: str) -> list[str]:
    if not isinstance(metadata, dict):
        return [f"`{rel_path}` is missing `{field}`."]
    issues: list[str] = []
    status = str(metadata.get("status") or "").strip().lower()
    if status != APPROVED_STATUS:
        current = status or "missing"
        issues.append(f"`{rel_path}` `{field}.status` must be \"{APPROVED_STATUS}\"; current: \"{current}\".")
    if not str(metadata.get("approved_by") or "").strip():
        issues.append(f"`{rel_path}` `{field}.approved_by` is required.")
    if not str(metadata.get("approved_at") or "").strip():
        issues.append(f"`{rel_path}` `{field}.approved_at` is required.")
    return issues


def is_approved(metadata: Any) -> bool:
    return not _approval_issues(metadata, "<metadata>", "approval")


def _term_key(value: object) -> str:
    return " ".join(str(value or "").split()).casefold()


def _leaf_strings(value: Any) -> set[str]:
    if isinstance(value, str):
        text = value.strip()
        return {text} if text else set()
    if isinstance(value, list):
        terms: set[str] = set()
        for item in value:
            terms.update(_leaf_strings(item))
        return terms
    if isinstance(value, dict):
        terms: set[str] = set()
        for item in value.values():
            terms.update(_leaf_strings(item))
        return terms
    return set()


def _keyword_field_terms(value: Any) -> set[str]:
    terms: set[str] = set()
    if isinstance(value, dict):
        for key, item in value.items():
            if str(key).strip().lower() in KEYWORD_FIELD_NAMES:
                terms.update(_leaf_strings(item))
            else:
                terms.update(_keyword_field_terms(item))
    elif isinstance(value, list):
        for item in value:
            terms.update(_keyword_field_terms(item))
    return terms


def _matrix_terms(matrix: dict[str, Any], channel: str) -> set[str]:
    terms = _leaf_strings((matrix.get("channel_keywords") or {}).get(channel) or [])
    for category in matrix.get("categories") or []:
        if not isinstance(category, dict):
            continue
        category_channels = [str(item) for item in category.get("channels") or []]
        if category_channels and channel not in category_channels:
            continue
        terms.update(_leaf_strings(category.get("zh") or []))
        terms.update(_leaf_strings(category.get("en") or []))
    return terms


def _channel_terms(channel_config: dict[str, Any]) -> set[str]:
    return _keyword_field_terms(channel_config.get("crawl_plan") or {})


def _unapproved_keywords(
    matrix: dict[str, Any],
    channel_config: dict[str, Any],
    channel: str,
    keywords: Iterable[object],
) -> list[str]:
    allowed = {_term_key(term) for term in _matrix_terms(matrix, channel) | _channel_terms(channel_config)}
    missing: list[str] = []
    seen: set[str] = set()
    for keyword in keywords:
        text = str(keyword or "").strip()
        key = _term_key(text)
        if not key or key in seen:
            continue
        seen.add(key)
        if key not in allowed:
            missing.append(text)
    return missing


def require_keyword_approval(
    root: Path,
    scenario_id: str,
    channel: str | None = None,
    *,
    operation: str = "run research workflow",
    keywords: Iterable[object] | None = None,
) -> None:
    """Fail unless the scenario and optional channel keywords are explicitly approved."""
    root = Path(root)
    matrix_rel = f"keyword_matrices/{scenario_id}.json"
    matrix = _read_required_json(root / matrix_rel, matrix_rel)
    issues = _approval_issues(matrix.get("approval"), matrix_rel, "approval")
    matrix_scenario = str(matrix.get("scenario_id") or "").strip()
    if matrix_scenario and matrix_scenario != scenario_id:
        issues.append(f"`{matrix_rel}` scenario_id must be \"{scenario_id}\"; current: \"{matrix_scenario}\".")

    channel_config: dict[str, Any] | None = None
    if channel:
        channel_rel = f"channels/{channel}.json"
        channel_config = _read_required_json(root / channel_rel, channel_rel)
        channel_id = str(channel_config.get("id") or "").strip()
        if channel_id and channel_id != channel:
            issues.append(f"`{channel_rel}` id must be \"{channel}\"; current: \"{channel_id}\".")
        issues.extend(_approval_issues(channel_config.get("keyword_approval"), channel_rel, "keyword_approval"))
        if keywords is not None:
            missing = _unapproved_keywords(matrix, channel_config, channel, keywords)
            if missing:
                preview = ", ".join(f"`{item}`" for item in missing[:10])
                suffix = "" if len(missing) <= 10 else f" and {len(missing) - 10} more"
                issues.append(
                    f"Unapproved keywords for channel `{channel}`: {preview}{suffix}. "
                    f"Add them to `{matrix_rel}` or `channels/{channel}.json`, then re-approve."
                )

    if issues:
        instructions = [
            f"Keyword approval required before {operation}.",
            *[f"- {issue}" for issue in issues],
            "- Generate or update the keyword draft first, get explicit human confirmation, then set "
            "`approval.status` / `keyword_approval.status` to \"approved\" with `approved_by` and `approved_at`.",
        ]
        raise KeywordApprovalError("\n".join(instructions))
