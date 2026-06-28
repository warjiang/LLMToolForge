from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


EXIT_COLLECTION_BLOCKED = 2

NETWORK_PATTERNS = [
    "nodename nor servname provided",
    "err_name_not_resolved",
    "找不到",
    "服务器 ip 地址",
    "operation not permitted",
    "name or service not known",
    "name resolution",
    "temporary failure in name resolution",
    "failed to establish",
    "connection refused",
    "network is unreachable",
    "timeout",
    "timed out",
]

LOGIN_PATTERNS = [
    "登录",
    "扫码",
    "验证码",
    "安全验证",
    "安全校验",
    "访问太频繁",
    "请先登录",
    "login",
    "sign in",
    "captcha",
    "verification",
]

RATE_LIMIT_PATTERNS = [
    "too many requests",
    "rate limit",
    "429",
    "访问过于频繁",
]


def _as_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if value in (None, "", {}):
        return []
    return [value]


def _text(value: Any) -> str:
    if isinstance(value, dict):
        return " ".join(str(item) for item in value.values() if item not in (None, ""))
    return str(value or "")


def _classify(text: str) -> str:
    lowered = text.lower()
    if any(pattern in lowered for pattern in NETWORK_PATTERNS):
        return "network_restricted"
    if any(pattern.lower() in lowered for pattern in LOGIN_PATTERNS):
        return "login_or_verification_required"
    if any(pattern in lowered for pattern in RATE_LIMIT_PATTERNS):
        return "rate_limited"
    return "unknown_error"


def _label(issue_type: str) -> str:
    return {
        "network_restricted": "网络/DNS/沙箱限制",
        "login_or_verification_required": "未登录或触发验证",
        "rate_limited": "频率限制",
        "empty_result": "无可导入结果",
        "unknown_error": "未知抓取异常",
    }.get(issue_type, issue_type)


def _next_action(issue_type: str) -> str:
    return {
        "network_restricted": "确认网络、代理、DNS 或执行权限后，重新运行当前 collect 目标。",
        "login_or_verification_required": "在当前 Chrome 中登录目标站点并通过验证后，重新运行当前 collect 目标。",
        "rate_limited": "等待频率限制解除，必要时降低 search_top_n/detail_top_n 或增加 pause_seconds 后重试。",
        "empty_result": "先检查关键词、登录状态和页面是否可见；确认不是异常后再决定是否接受空结果。",
        "unknown_error": "查看 collector stderr、probe 截图和 source JSON，定位原因后重试。",
    }.get(issue_type, "修复抓取异常后重试。")


def _probe_issues(probes: list[Any], fail_on_login_wall: bool) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    for probe in probes:
        if not isinstance(probe, dict):
            continue
        if fail_on_login_wall and probe.get("login_or_verification_wall"):
            issues.append({
                "type": "login_or_verification_required",
                "where": probe.get("surface") or probe.get("query") or "probe",
                "detail": "probe 标记 login_or_verification_wall=true",
                "screenshot_path": probe.get("screenshot_path", ""),
            })
        probe_error = str(probe.get("error") or "")
        if probe_error:
            issues.append({
                "type": _classify(probe_error),
                "where": probe.get("surface") or probe.get("query") or "probe",
                "detail": probe_error,
                "screenshot_path": probe.get("screenshot_path", ""),
            })
        status = str(probe.get("status") or "")
        if re.search(r"(failed|error)", status, re.I):
            issues.append({
                "type": _classify(status),
                "where": probe.get("store") or probe.get("surface") or probe.get("query") or "probe",
                "detail": status,
            })
    return issues


def _error_where(error: Any) -> str:
    if not isinstance(error, dict):
        return "collector"
    return str(error.get("surface") or error.get("query") or error.get("source_id") or error.get("topic_id") or "collector")


def diagnose_collection(
    envelope: dict[str, Any],
    *,
    channel: str,
    min_records: int = 1,
    fail_on_errors: bool = True,
    fail_on_login_wall: bool = True,
) -> dict[str, Any]:
    meta = envelope.setdefault("meta", {})
    records = list(envelope.get("records") or [])
    errors = _as_list(meta.get("errors"))
    probes = _as_list(meta.get("probes"))

    issues: list[dict[str, Any]] = []
    for error in errors:
        detail = _text(error)
        issues.append({
            "type": _classify(detail),
            "where": _error_where(error),
            "detail": detail,
        })
    issues.extend(_probe_issues(probes, fail_on_login_wall=fail_on_login_wall))
    if len(records) < min_records:
        issues.append({
            "type": "empty_result",
            "where": channel,
            "detail": f"records={len(records)}，低于最小可导入阈值 {min_records}",
        })

    blocking_issues = []
    for issue in issues:
        if issue["type"] in {"login_or_verification_required", "network_restricted", "rate_limited", "empty_result"}:
            blocking_issues.append(issue)
        elif fail_on_errors:
            blocking_issues.append(issue)

    issue_types = [issue["type"] for issue in blocking_issues]
    primary_type = issue_types[0] if issue_types else ""
    return {
        "channel": channel,
        "blocked": bool(blocking_issues),
        "primary_issue_type": primary_type,
        "primary_issue_label": _label(primary_type) if primary_type else "",
        "record_count": len(records),
        "error_count": len(errors),
        "probe_count": len(probes),
        "issues": blocking_issues[:20],
        "next_action": _next_action(primary_type) if primary_type else "可以继续 ingest/normalize/audit/analyze。",
    }


def _diagnosis_markdown(diagnosis: dict[str, Any]) -> str:
    lines = [
        f"# Collection Diagnosis: {diagnosis.get('channel', '')}",
        "",
        f"- blocked: {diagnosis.get('blocked')}",
        f"- primary_issue: {diagnosis.get('primary_issue_label') or '无'}",
        f"- records: {diagnosis.get('record_count')}",
        f"- errors: {diagnosis.get('error_count')}",
        f"- probes: {diagnosis.get('probe_count')}",
        f"- next_action: {diagnosis.get('next_action')}",
        "",
    ]
    issues = diagnosis.get("issues") or []
    if issues:
        lines += ["## Issues", "", "| 类型 | 位置 | 详情 | 截图 |", "|---|---|---|---|"]
        for issue in issues:
            detail = str(issue.get("detail") or "").replace("|", " ").replace("\n", " ")[:240]
            lines.append(
                f"| {_label(str(issue.get('type') or 'unknown_error'))} | {issue.get('where', '')} | {detail} | {issue.get('screenshot_path', '')} |"
            )
        lines.append("")
    return "\n".join(lines)


def write_collection_output(
    output: Path,
    envelope: dict[str, Any],
    *,
    channel: str,
    min_records: int = 1,
    fail_on_errors: bool = True,
    fail_on_login_wall: bool = True,
) -> int:
    diagnosis = diagnose_collection(
        envelope,
        channel=channel,
        min_records=min_records,
        fail_on_errors=fail_on_errors,
        fail_on_login_wall=fail_on_login_wall,
    )
    envelope.setdefault("meta", {})["collection_status"] = diagnosis
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(envelope, ensure_ascii=False, indent=2), encoding="utf-8")
    diagnosis_json = output.with_suffix(".diagnosis.json")
    diagnosis_md = output.with_suffix(".diagnosis.md")
    diagnosis_json.write_text(json.dumps(diagnosis, ensure_ascii=False, indent=2), encoding="utf-8")
    diagnosis_md.write_text(_diagnosis_markdown(diagnosis), encoding="utf-8")
    if diagnosis["blocked"]:
        print(
            f"COLLECTION PAUSED [{channel}]: {diagnosis['primary_issue_label']}；"
            f"{diagnosis['next_action']} 诊断文件：{diagnosis_md}",
        )
        return EXIT_COLLECTION_BLOCKED
    print(f"Collection diagnosis OK [{channel}]: {diagnosis['record_count']} records. 诊断文件：{diagnosis_md}")
    return 0
