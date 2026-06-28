from __future__ import annotations

from collections import Counter
from pathlib import Path
import shlex
import subprocess
import sys
from typing import Any

from .approval import require_keyword_approval
from .ingest import ingest_file
from .storage import read_json, read_jsonl, utc_now, write_json


# Root of the (vendored) harness, i.e. the directory that contains `scripts/`.
# Collector argv in delta plans use relative `scripts/collect_*.py` paths and a
# bare `python3`; both are resolved against this root at execution time so the
# harness works regardless of the session data root passed via `--root`.
HARNESS_ROOT = Path(__file__).resolve().parent.parent


def _resolve_collector_argv(argv: list[str]) -> list[str]:
    """Make a planned collector argv runnable from the vendored harness.

    - Replace a leading bare ``python``/``python3`` with ``sys.executable`` so the
      same interpreter that runs the harness runs the collectors.
    - Rewrite a relative ``scripts/...`` script path to an absolute path under
      ``HARNESS_ROOT`` so it resolves no matter what ``cwd`` the collector uses.
    """
    if not argv:
        return argv
    resolved = list(argv)
    if Path(resolved[0]).name in {"python", "python3"} and sys.executable:
        resolved[0] = sys.executable
    for index in range(1, len(resolved)):
        token = resolved[index]
        if token.startswith("-"):
            continue
        candidate = Path(token)
        if not candidate.is_absolute() and candidate.parts and candidate.parts[0] == "scripts":
            absolute = HARNESS_ROOT / candidate
            if absolute.exists():
                resolved[index] = str(absolute)
        break
    return resolved


SUPPORTED_CHANNELS = {
    "xiaohongshu",
    "v2ex",
    "appstore",
    "wechat-ecosystem",
    "reddit",
    "zhihu",
    "5118-index",
    "oceanengine-index",
    "douyin-index",
    "wechat-index",
}
SEARCH_INDEX_CHANNELS = {"5118-index", "oceanengine-index", "douyin-index", "wechat-index"}
PLAN_STATUS_PENDING = "pending_review"
PLAN_STATUS_APPROVED = "approved"


def _read_json_if_exists(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    data = read_json(path)
    return data if isinstance(data, dict) else {}


def _term_key(value: object) -> str:
    return " ".join(str(value or "").split()).casefold()


def _unique_terms(values: list[object]) -> list[str]:
    seen: set[str] = set()
    terms: list[str] = []
    for value in values:
        text = str(value or "").strip()
        key = _term_key(text)
        if not key or key in seen:
            continue
        seen.add(key)
        terms.append(text)
    return terms


def _channel_config(root: Path, channel: str) -> dict[str, Any]:
    return _read_json_if_exists(root / "channels" / f"{channel}.json")


def _scenario_channels(root: Path, scenario_id: str, matrix: dict[str, Any]) -> list[str]:
    scenario = _read_json_if_exists(root / "scenarios" / f"{scenario_id}.json")
    channels: list[object] = []
    channels.extend(scenario.get("channels") or [])
    channels.extend((matrix.get("channel_keywords") or {}).keys())
    raw_base = root / "data" / "raw" / scenario_id
    if raw_base.exists():
        channels.extend(path.name for path in raw_base.iterdir() if path.is_dir())
    channels.extend(path.stem for path in (root / "channels").glob("*.json"))
    return _unique_terms(channels)


def _appstore_android_target_queries(channel_config: dict[str, Any]) -> list[str]:
    targets = ((channel_config.get("crawl_plan") or {}).get("android_market_targets") or {})
    queries: list[object] = []
    for group in ["google_play", "domestic_android"]:
        for target in targets.get(group) or []:
            if isinstance(target, dict):
                queries.append(target.get("query"))
    return _unique_terms(queries)


def _configured_keywords(root: Path, scenario_id: str, channel: str, matrix: dict[str, Any]) -> list[str]:
    channel_config = _channel_config(root, channel)
    plan = channel_config.get("crawl_plan") or {}
    values: list[object] = []
    values.extend(plan.get("keywords") or [])
    values.extend((matrix.get("channel_keywords") or {}).get(channel) or [])
    if channel == "appstore":
        values.extend(_appstore_android_target_queries(channel_config))
    return _unique_terms(values)


def _raw_keyword_coverage(root: Path, scenario_id: str, channel: str) -> tuple[set[str], set[str]]:
    attempted: set[str] = set()
    with_evidence: set[str] = set()
    raw_dir = root / "data" / "raw" / scenario_id / channel
    for raw_file in sorted(raw_dir.glob("*.raw.json")) if raw_dir.exists() else []:
        run = _read_json_if_exists(raw_file)
        meta = run.get("meta") or {}
        for keyword in meta.get("keywords") or []:
            key = _term_key(keyword)
            if key:
                attempted.add(key)
        for record in run.get("records") or []:
            if not isinstance(record, dict):
                continue
            query = record.get("query")
            key = _term_key(query)
            if key:
                attempted.add(key)
                with_evidence.add(key)
    return attempted, with_evidence


def _delta_base_dir(scenario_id: str, batch_id: str) -> Path:
    return Path("/private/tmp/research-harness") / scenario_id / batch_id


def _batch_run_id(prefix: str, batch_id: str) -> str:
    return f"{prefix}-{batch_id}"


def _command_item(
    *,
    id: str,
    channel: str,
    argv: list[str],
    output: Path,
    run_id: str,
    keywords: list[str],
) -> dict[str, Any]:
    return {
        "id": id,
        "channel": channel,
        "argv": argv,
        "output": str(output),
        "source_format": "evidence-list",
        "run_id": run_id,
        "keywords": keywords,
    }


def _collector_commands(root: Path, scenario_id: str, batch_id: str, channel: str, delta_keywords: list[str]) -> list[dict[str, Any]]:
    if not delta_keywords or channel not in SUPPORTED_CHANNELS:
        return []
    base_dir = _delta_base_dir(scenario_id, batch_id)
    keyword_args = [arg for keyword in delta_keywords for arg in ["--keyword", keyword]]
    if channel in SEARCH_INDEX_CHANNELS:
        output = base_dir / f"{channel}.json"
        return [
            _command_item(
                id=channel,
                channel=channel,
                argv=[
                    "python3",
                    "scripts/collect_search_index.py",
                    "--channel",
                    channel,
                    "--output",
                    str(output),
                    "--method",
                    "browser",
                    *keyword_args,
                ],
                output=output,
                run_id=_batch_run_id(channel, batch_id),
                keywords=delta_keywords,
            )
        ]
    if channel == "xiaohongshu":
        output = base_dir / "xiaohongshu.json"
        return [
            _command_item(
                id="xiaohongshu",
                channel=channel,
                argv=[
                    "python3",
                    "scripts/collect_xiaohongshu.py",
                    "--output",
                    str(output),
                    *keyword_args,
                    "--search-top-n",
                    "20",
                    "--detail-top-n",
                    "8",
                    "--max-total-records",
                    "160",
                ],
                output=output,
                run_id=_batch_run_id("xiaohongshu", batch_id),
                keywords=delta_keywords,
            )
        ]
    if channel == "v2ex":
        output = base_dir / "v2ex.json"
        return [
            _command_item(
                id="v2ex",
                channel=channel,
                argv=[
                    "python3",
                    "scripts/collect_v2ex.py",
                    "--output",
                    str(output),
                    "--skip-default-topics",
                    *keyword_args,
                ],
                output=output,
                run_id=_batch_run_id("v2ex", batch_id),
                keywords=delta_keywords,
            )
        ]
    if channel == "wechat-ecosystem":
        output = base_dir / "wechat-ecosystem.json"
        return [
            _command_item(
                id="wechat-ecosystem",
                channel=channel,
                argv=["python3", "scripts/collect_wechat_ecosystem.py", "--output", str(output), *keyword_args],
                output=output,
                run_id=_batch_run_id("wechat-ecosystem", batch_id),
                keywords=delta_keywords,
            )
        ]
    if channel == "reddit":
        output = base_dir / "reddit.json"
        return [
            _command_item(
                id="reddit",
                channel=channel,
                argv=[
                    "python3",
                    "scripts/collect_reddit.py",
                    "--output",
                    str(output),
                    "--search-top-n",
                    "2",
                    "--comments-top-n",
                    "0",
                    "--subreddits-per-keyword",
                    "1",
                    "--max-combinations",
                    str(len(delta_keywords)),
                    "--timeout-seconds",
                    "12",
                    "--retry-count",
                    "1",
                    *keyword_args,
                ],
                output=output,
                run_id=_batch_run_id("reddit", batch_id),
                keywords=delta_keywords,
            )
        ]
    if channel == "zhihu":
        output = base_dir / "zhihu.json"
        return [
            _command_item(
                id="zhihu",
                channel=channel,
                argv=["python3", "scripts/collect_zhihu.py", "--output", str(output), *keyword_args],
                output=output,
                run_id=_batch_run_id("zhihu", batch_id),
                keywords=delta_keywords,
            )
        ]
    if channel == "appstore":
        channel_config = _channel_config(root, channel)
        android_targets = {_term_key(term) for term in _appstore_android_target_queries(channel_config)}
        android_keywords = [keyword for keyword in delta_keywords if _term_key(keyword) in android_targets]
        commands = [
            _command_item(
                id="appstore-itunes",
                channel=channel,
                argv=[
                    "python3",
                    "scripts/collect_appstore.py",
                    "--output",
                    str(base_dir / "appstore-itunes.json"),
                    *keyword_args,
                ],
                output=base_dir / "appstore-itunes.json",
                run_id=_batch_run_id("appstore-itunes", batch_id),
                keywords=delta_keywords,
            )
        ]
        if android_keywords:
            target_args = [arg for keyword in android_keywords for arg in ["--target-query", keyword]]
            commands.append(
                _command_item(
                    id="appstore-android-markets",
                    channel=channel,
                    argv=[
                        "python3",
                        "scripts/collect_android_markets.py",
                        "--output",
                        str(base_dir / "appstore-android-markets.json"),
                        *target_args,
                    ],
                    output=base_dir / "appstore-android-markets.json",
                    run_id=_batch_run_id("appstore-android-markets", batch_id),
                    keywords=android_keywords,
                )
            )
        return commands
    return []


def _plan_paths(root: Path, scenario_id: str, batch_id: str) -> tuple[Path, Path]:
    base = root / "analysis" / scenario_id / "deltas"
    return base / f"{batch_id}.plan.json", base / f"{batch_id}.plan.md"


def _report_paths(root: Path, scenario_id: str, batch_id: str) -> tuple[Path, Path]:
    base = root / "analysis" / scenario_id / "deltas"
    return base / f"{batch_id}.report.json", base / f"{batch_id}.report.md"


def _plan_markdown(plan: dict[str, Any]) -> str:
    lines = [
        f"# 新增关键词增量补采计划：{plan['batch_id']}",
        "",
        f"- 场景：`{plan['scenario_id']}`",
        f"- 状态：`{plan['approval']['status']}`",
        f"- 严格策略：{'启用' if plan.get('strict_blocking') else '未启用'}",
        "",
        "## 审批规则",
        "",
        "- 本文件生成后先人工确认新增关键词。",
        "- 未执行 `approve-delta` 前，`collect-delta` 会拒绝运行。",
        "- 采集遇到登录、验证码、网络、限流或空结果阻断时，整个 batch 暂停，不入库部分结果。",
        "",
        "## 渠道计划",
        "",
        "| 渠道 | 新增待采 | 已有有效线索关键词 | 已尝试但无有效线索 | 状态 |",
        "| --- | ---: | ---: | ---: | --- |",
    ]
    for channel_plan in plan.get("channels") or []:
        status = "可补采" if channel_plan.get("commands") else channel_plan.get("status", "无新增")
        lines.append(
            f"| {channel_plan['channel']} | {len(channel_plan.get('delta_keywords') or [])} | "
            f"{len(channel_plan.get('evidence_keywords') or [])} | "
            f"{len(channel_plan.get('attempted_without_evidence') or [])} | {status} |"
        )
    lines += ["", "## 新增关键词明细", ""]
    for channel_plan in plan.get("channels") or []:
        delta_keywords = channel_plan.get("delta_keywords") or []
        if not delta_keywords:
            continue
        lines += [
            f"### {channel_plan['channel']}",
            "",
            "- 新增待采关键词：" + "、".join(delta_keywords),
        ]
        attempted_without = channel_plan.get("attempted_without_evidence") or []
        if attempted_without:
            lines.append("- 已尝试但无有效线索：" + "、".join(attempted_without))
        risks = channel_plan.get("risks") or []
        if risks:
            lines.append("- 风险：" + "；".join(risks))
        commands = channel_plan.get("commands") or []
        if commands:
            lines += ["", "```bash"]
            lines.extend(shlex.join(command["argv"]) for command in commands)
            lines.append("```")
        lines.append("")
    if not any(channel.get("delta_keywords") for channel in plan.get("channels") or []):
        lines.append("本次没有发现未尝试的新增关键词。")
        lines.append("")
    return "\n".join(lines)


def generate_delta_plan(root: Path, scenario_id: str, batch_id: str) -> tuple[Path, Path]:
    root = Path(root)
    if not batch_id.strip():
        raise ValueError("batch_id is required")
    matrix = _read_json_if_exists(root / "keyword_matrices" / f"{scenario_id}.json")
    channels: list[dict[str, Any]] = []
    for channel in _scenario_channels(root, scenario_id, matrix):
        if channel not in SUPPORTED_CHANNELS:
            continue
        configured = _configured_keywords(root, scenario_id, channel, matrix)
        if not configured:
            continue
        attempted, with_evidence = _raw_keyword_coverage(root, scenario_id, channel)
        delta = [keyword for keyword in configured if _term_key(keyword) not in attempted]
        evidence_keywords = [keyword for keyword in configured if _term_key(keyword) in with_evidence]
        attempted_without = [
            keyword for keyword in configured if _term_key(keyword) in attempted and _term_key(keyword) not in with_evidence
        ]
        risks: list[str] = []
        if channel in {"xiaohongshu", "wechat-ecosystem"}:
            risks.append("需要确认浏览器登录态，遇到登录/验证墙会阻断整个 batch")
        if channel in {"zhihu", "wechat-ecosystem"}:
            risks.append("搜索引擎索引可能只返回摘要级证据")
        if channel == "appstore":
            risks.append("应用市场关键词按竞品/App 目标处理，不按普通场景词处理")
        if channel in SEARCH_INDEX_CHANNELS:
            risks.append("指数渠道需要用户登录平台并提供导出 CSV/JSON；未提供导出时采集器会阻断 batch")
        commands = _collector_commands(root, scenario_id, batch_id, channel, delta)
        channels.append(
            {
                "channel": channel,
                "configured_keywords": configured,
                "attempted_keywords": [keyword for keyword in configured if _term_key(keyword) in attempted],
                "evidence_keywords": evidence_keywords,
                "attempted_without_evidence": attempted_without,
                "delta_keywords": delta,
                "status": "ready_for_review" if delta else "no_delta_keywords",
                "risks": risks,
                "commands": commands,
            }
        )
    plan = {
        "scenario_id": scenario_id,
        "batch_id": batch_id,
        "created_at": utc_now(),
        "approval": {
            "status": PLAN_STATUS_PENDING,
            "approved_by": "",
            "approved_at": "",
            "note": "新增关键词增量补采计划生成后需人工确认，再执行 approve-delta。",
        },
        "strict_blocking": True,
        "channels": channels,
    }
    json_path, md_path = _plan_paths(root, scenario_id, batch_id)
    write_json(json_path, plan)
    md_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.write_text(_plan_markdown(plan), encoding="utf-8")
    return json_path, md_path


def load_delta_plan(root: Path, scenario_id: str, batch_id: str, *, require_approved: bool = False) -> dict[str, Any]:
    json_path, _ = _plan_paths(root, scenario_id, batch_id)
    if not json_path.exists():
        raise FileNotFoundError(f"Delta plan not found: {json_path}")
    plan = read_json(json_path)
    if plan.get("scenario_id") != scenario_id:
        raise ValueError(f"Delta plan scenario mismatch: {plan.get('scenario_id')} != {scenario_id}")
    if plan.get("batch_id") != batch_id:
        raise ValueError(f"Delta plan batch mismatch: {plan.get('batch_id')} != {batch_id}")
    status = ((plan.get("approval") or {}).get("status") or "").strip()
    if require_approved and status != PLAN_STATUS_APPROVED:
        raise RuntimeError(
            f"Delta plan `{batch_id}` is `{status or 'missing'}`. "
            "请先人工确认关键词，然后执行 approve-delta。"
        )
    return plan


def _planned_commands(plan: dict[str, Any]) -> list[dict[str, Any]]:
    commands: list[dict[str, Any]] = []
    for channel_plan in plan.get("channels") or []:
        for command in channel_plan.get("commands") or []:
            commands.append(command)
    return commands


def _require_plan_keywords_approved(root: Path, scenario_id: str, plan: dict[str, Any]) -> None:
    for channel_plan in plan.get("channels") or []:
        commands = channel_plan.get("commands") or []
        if not commands:
            continue
        keywords = _unique_terms([keyword for command in commands for keyword in command.get("keywords") or []])
        if not keywords:
            continue
        require_keyword_approval(
            root,
            scenario_id,
            channel_plan.get("channel"),
            operation="approve or run delta keyword collection",
            keywords=keywords,
        )


def approve_delta_plan(root: Path, scenario_id: str, batch_id: str, approved_by: str, note: str = "") -> tuple[Path, Path]:
    root = Path(root)
    if not approved_by.strip():
        raise ValueError("approved_by is required")
    plan = load_delta_plan(root, scenario_id, batch_id)
    _require_plan_keywords_approved(root, scenario_id, plan)
    plan["approval"] = {
        "status": PLAN_STATUS_APPROVED,
        "approved_by": approved_by.strip(),
        "approved_at": utc_now(),
        "note": note or "用户确认本 batch 的新增关键词，可以执行增量补采。",
    }
    json_path, md_path = _plan_paths(root, scenario_id, batch_id)
    write_json(json_path, plan)
    md_path.write_text(_plan_markdown(plan), encoding="utf-8")
    return json_path, md_path


def collect_delta(
    root: Path,
    scenario_id: str,
    batch_id: str,
    *,
    dry_run: bool = False,
    only_channels: list[str] | None = None,
    skip_channels: list[str] | None = None,
) -> Path:
    root = Path(root)
    plan = load_delta_plan(root, scenario_id, batch_id, require_approved=True)
    _require_plan_keywords_approved(root, scenario_id, plan)
    commands = _planned_commands(plan)
    only_set = {c.strip() for c in (only_channels or []) if c.strip()}
    skip_set = {c.strip() for c in (skip_channels or []) if c.strip()}
    if only_set:
        commands = [c for c in commands if c.get("channel") in only_set]
    if skip_set:
        commands = [c for c in commands if c.get("channel") not in skip_set]
    run_log = {
        "scenario_id": scenario_id,
        "batch_id": batch_id,
        "started_at": utc_now(),
        "dry_run": dry_run,
        "strict_blocking": True,
        "only_channels": sorted(only_set),
        "skip_channels": sorted(skip_set),
        "commands": [],
        "status": "not_started",
    }
    log_path = root / "data" / "runs" / scenario_id / f"{batch_id}.collection.json"
    if not commands:
        run_log["status"] = "no_delta_commands"
        write_json(log_path, run_log)
        return log_path
    for command in commands:
        argv = list(command.get("argv") or [])
        if not argv:
            raise RuntimeError(f"Invalid empty command in delta plan `{batch_id}`.")
        run_argv = _resolve_collector_argv(argv)
        output = Path(str(command.get("output") or ""))
        output.parent.mkdir(parents=True, exist_ok=True)
        entry = {
            "id": command.get("id"),
            "channel": command.get("channel"),
            "run_id": command.get("run_id"),
            "output": str(output),
            "argv": argv,
            "started_at": utc_now(),
        }
        if not dry_run and _existing_collection_ok(output):
            entry["status"] = "skipped_existing_ok"
            entry["finished_at"] = utc_now()
            run_log["commands"].append(entry)
            write_json(log_path, run_log)
            continue
        if dry_run:
            entry["status"] = "dry_run"
            print(shlex.join(run_argv))
        else:
            completed = subprocess.run(run_argv, cwd=root, text=True, capture_output=True, check=False)
            entry.update(
                {
                    "returncode": completed.returncode,
                    "stdout_tail": completed.stdout[-4000:],
                    "stderr_tail": completed.stderr[-4000:],
                    "finished_at": utc_now(),
                    "status": "ok" if completed.returncode == 0 else "blocked",
                }
            )
            if completed.returncode != 0:
                run_log["commands"].append(entry)
                run_log["status"] = "blocked"
                run_log["finished_at"] = utc_now()
                write_json(log_path, run_log)
                raise RuntimeError(
                    f"Delta collection blocked at `{command.get('id')}` with exit code {completed.returncode}. "
                    f"诊断文件通常在 {output.with_suffix('.diagnosis.md')}。修复后重跑 collect-delta。"
                )
        run_log["commands"].append(entry)
        write_json(log_path, run_log)
    run_log["status"] = "dry_run" if dry_run else "ok"
    run_log["finished_at"] = utc_now()
    write_json(log_path, run_log)
    return log_path


def _collector_output_status(output: Path) -> tuple[bool, str]:
    if not output.exists():
        return False, f"missing output: {output}"
    data = read_json(output)
    status = ((data.get("meta") or {}).get("collection_status") or {}) if isinstance(data, dict) else {}
    if status.get("blocked"):
        label = status.get("primary_issue_label") or status.get("primary_issue_type") or "collector blocked"
        return False, f"blocked output: {output} ({label})"
    return True, ""


def _existing_collection_ok(output: Path) -> bool:
    if not output.exists():
        return False
    try:
        data = read_json(output)
    except (OSError, ValueError):
        return False
    status = ((data.get("meta") or {}).get("collection_status") or {}) if isinstance(data, dict) else {}
    if not status:
        return False
    return not bool(status.get("blocked"))


def ingest_delta(
    root: Path,
    scenario_id: str,
    batch_id: str,
    *,
    skip_channels: list[str] | None = None,
) -> list[Path]:
    root = Path(root)
    plan = load_delta_plan(root, scenario_id, batch_id, require_approved=True)
    _require_plan_keywords_approved(root, scenario_id, plan)
    commands = _planned_commands(plan)
    skip_set = {c.strip() for c in (skip_channels or []) if c.strip()}
    if skip_set:
        commands = [c for c in commands if c.get("channel") not in skip_set]
    errors: list[str] = []
    for command in commands:
        ok, message = _collector_output_status(Path(str(command.get("output"))))
        if not ok:
            errors.append(message)
    if errors:
        raise RuntimeError("Delta ingest refused because collection is incomplete or blocked:\n- " + "\n- ".join(errors))
    paths: list[Path] = []
    for command in commands:
        paths.append(
            ingest_file(
                root=root,
                scenario_id=scenario_id,
                channel=str(command.get("channel")),
                input_path=Path(str(command.get("output"))),
                source_format=str(command.get("source_format") or "evidence-list"),
                run_id=str(command.get("run_id")),
                batch_id=batch_id,
                delta_keywords=list(command.get("keywords") or []),
            )
        )
    return paths


def report_delta(root: Path, scenario_id: str, batch_id: str) -> tuple[Path, Path]:
    root = Path(root)
    plan = load_delta_plan(root, scenario_id, batch_id)
    run_ids = {str(command.get("run_id")) for command in _planned_commands(plan) if command.get("run_id")}
    rows = read_jsonl(root / "data" / "normalized" / scenario_id / "evidence.jsonl")
    batch_rows: list[dict[str, Any]] = []
    effective_new_rows: list[dict[str, Any]] = []
    merged_existing_rows: list[dict[str, Any]] = []
    for row in rows:
        row_run_ids = {item.strip() for item in str(row.get("raw_run_id") or "").split(",") if item.strip()}
        if not row_run_ids & run_ids:
            continue
        batch_rows.append(row)
        if row_run_ids <= run_ids:
            effective_new_rows.append(row)
        else:
            merged_existing_rows.append(row)
    report = {
        "scenario_id": scenario_id,
        "batch_id": batch_id,
        "generated_at": utc_now(),
        "run_ids": sorted(run_ids),
        "planned_delta_keywords": {
            channel_plan["channel"]: channel_plan.get("delta_keywords") or []
            for channel_plan in plan.get("channels") or []
            if channel_plan.get("delta_keywords")
        },
        "batch_linked_evidence_count": len(batch_rows),
        "effective_new_evidence_count": len(effective_new_rows),
        "merged_existing_evidence_count": len(merged_existing_rows),
        "by_channel": dict(Counter(row.get("channel") for row in batch_rows)),
        "by_platform": dict(Counter(row.get("primary_platform") for row in batch_rows)),
        "by_record_type": dict(Counter(row.get("record_type") for row in batch_rows)),
        "by_confidence": dict(Counter(row.get("confidence") for row in batch_rows)),
    }
    json_path, md_path = _report_paths(root, scenario_id, batch_id)
    write_json(json_path, report)
    lines = [
        f"# 增量补采影响报告：{batch_id}",
        "",
        f"- 场景：`{scenario_id}`",
        f"- 关联 run：{', '.join(sorted(run_ids)) or '无'}",
        f"- 关联线索数：{len(batch_rows)}",
        f"- 有效新增线索数：{len(effective_new_rows)}",
        f"- 与旧 run 合并去重线索数：{len(merged_existing_rows)}",
        "",
        "## 新增关键词",
        "",
    ]
    if report["planned_delta_keywords"]:
        for channel, keywords in report["planned_delta_keywords"].items():
            lines.append(f"- {channel}：{'、'.join(keywords)}")
    else:
        lines.append("- 本 batch 没有新增关键词。")
    lines += [
        "",
        "## 分布",
        "",
        f"- 按渠道：{dict(report['by_channel'])}",
        f"- 按平台：{dict(report['by_platform'])}",
        f"- 按线索类型：{dict(report['by_record_type'])}",
        f"- 按置信度：{dict(report['by_confidence'])}",
        "",
        "## 结论影响",
        "",
    ]
    if not batch_rows:
        lines.append("- 尚未发现已归一化的 batch 线索。请先执行 `ingest-delta`、`normalize` 后重跑本报告。")
    elif effective_new_rows:
        lines.append("- 本 batch 带来新的去重后线索，应重新生成渠道结论和场景汇总。")
    else:
        lines.append("- 本 batch 主要与旧 run 合并，当前未增加新的去重后线索。")
    lines.append("")
    md_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return json_path, md_path


def latest_delta_reports(root: Path, scenario_id: str, limit: int = 3) -> list[dict[str, Any]]:
    report_dir = root / "analysis" / scenario_id / "deltas"
    reports: list[dict[str, Any]] = []
    for path in sorted(report_dir.glob("*.report.json"), reverse=True) if report_dir.exists() else []:
        report = _read_json_if_exists(path)
        if report:
            report["_path"] = str(path)
            report["_md_path"] = str(path.with_suffix(".md"))
            reports.append(report)
        if len(reports) >= limit:
            break
    return reports
