from __future__ import annotations

import argparse
from pathlib import Path
import sys

from .approval import KeywordApprovalError, require_keyword_approval
from .analyze import analyze_scenario
from .audit import audit_evidence
from .delta import approve_delta_plan, collect_delta, generate_delta_plan, ingest_delta, report_delta
from .ingest import ingest_file
from .models import DEFAULT_DIMENSIONS, Scenario
from .normalize import normalize_scenario
from .notion import publish_markdown
from .storage import ensure_layout, write_json


def default_root() -> Path:
    return Path.cwd()


def cmd_init(args: argparse.Namespace) -> None:
    root = Path(args.root).resolve()
    ensure_layout(root)
    for rel in ["data/raw/.gitkeep", "data/normalized/.gitkeep", "analysis/.gitkeep"]:
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch(exist_ok=True)
    print(f"Initialized research harness layout at {root}")


def cmd_new_scenario(args: argparse.Namespace) -> None:
    root = Path(args.root).resolve()
    ensure_layout(root)
    scenario = Scenario(
        id=args.scenario_id,
        name=args.name or args.scenario_id,
        description=args.description or "",
        target_users=args.target_user or [],
        validation_targets=args.validation_target or [],
        hypotheses=args.hypothesis or [],
        channels=args.channel or [],
        keywords={
            "pain": args.keyword or [],
            "scenario": [],
            "competitor": [],
            "emotion_payment": [],
        },
        coding={"dimensions": DEFAULT_DIMENSIONS},
    )
    out_path = root / "scenarios" / f"{scenario.id}.json"
    write_json(out_path, scenario.to_json())
    print(f"Created scenario: {out_path}")


def cmd_ingest(args: argparse.Namespace) -> None:
    out_path = ingest_file(
        root=Path(args.root).resolve(),
        scenario_id=args.scenario_id,
        channel=args.channel,
        input_path=Path(args.input).resolve(),
        source_format=args.format,
        run_id=args.run_id,
        batch_id=args.batch_id,
        delta_keywords=args.delta_keyword,
    )
    print(f"Ingested raw run: {out_path}")


def cmd_normalize(args: argparse.Namespace) -> None:
    out_path = normalize_scenario(Path(args.root).resolve(), args.scenario_id, args.channel, batch_id=args.batch_id)
    print(f"Normalized evidence: {out_path}")


def cmd_audit(args: argparse.Namespace) -> None:
    out_path, issues = audit_evidence(Path(args.root).resolve(), args.scenario_id)
    print(f"Audit report: {out_path}")
    print(f"Issues: {len(issues)}")
    for issue in issues[:20]:
        print(f"- {issue}")


def cmd_analyze(args: argparse.Namespace) -> None:
    paths = analyze_scenario(Path(args.root).resolve(), args.scenario_id)
    for path in paths:
        print(f"Wrote analysis: {path}")


def cmd_publish_notion(args: argparse.Namespace) -> None:
    require_keyword_approval(Path(args.root).resolve(), args.scenario_id, operation="publish analysis to Notion")
    count = publish_markdown(
        page_id=args.page,
        markdown_path=Path(args.source).resolve(),
        token=args.token,
        dry_run=args.dry_run,
    )
    action = "Would publish" if args.dry_run else "Published"
    print(f"{action} {count} Notion blocks from {args.source}")


def cmd_delta_plan(args: argparse.Namespace) -> None:
    json_path, md_path = generate_delta_plan(Path(args.root).resolve(), args.scenario_id, args.batch_id)
    print(f"Wrote delta plan: {json_path}")
    print(f"Wrote delta plan markdown: {md_path}")


def cmd_approve_delta(args: argparse.Namespace) -> None:
    json_path, md_path = approve_delta_plan(
        Path(args.root).resolve(),
        args.scenario_id,
        args.batch_id,
        approved_by=args.approved_by,
        note=args.note or "",
    )
    print(f"Approved delta plan: {json_path}")
    print(f"Updated delta plan markdown: {md_path}")


def cmd_collect_delta(args: argparse.Namespace) -> None:
    log_path = collect_delta(
        Path(args.root).resolve(),
        args.scenario_id,
        args.batch_id,
        dry_run=args.dry_run,
        only_channels=args.only_channel,
        skip_channels=args.skip_channel,
    )
    print(f"Wrote delta collection log: {log_path}")


def cmd_ingest_delta(args: argparse.Namespace) -> None:
    paths = ingest_delta(
        Path(args.root).resolve(),
        args.scenario_id,
        args.batch_id,
        skip_channels=args.skip_channel,
    )
    for path in paths:
        print(f"Ingested delta raw run: {path}")


def cmd_report_delta(args: argparse.Namespace) -> None:
    json_path, md_path = report_delta(Path(args.root).resolve(), args.scenario_id, args.batch_id)
    print(f"Wrote delta report: {json_path}")
    print(f"Wrote delta report markdown: {md_path}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="research", description="ResearchOps harness for multi-channel desk research")
    parser.add_argument("--root", default=".", help="Harness root directory")
    sub = parser.add_subparsers(dest="command", required=True)

    init_p = sub.add_parser("init", help="Create the harness directory layout")
    init_p.set_defaults(func=cmd_init)

    scenario_p = sub.add_parser("new-scenario", help="Create a scenario config")
    scenario_p.add_argument("scenario_id")
    scenario_p.add_argument("--name", default="")
    scenario_p.add_argument("--description", default="")
    scenario_p.add_argument("--target-user", action="append")
    scenario_p.add_argument("--validation-target", action="append")
    scenario_p.add_argument("--hypothesis", action="append")
    scenario_p.add_argument("--channel", action="append")
    scenario_p.add_argument("--keyword", action="append")
    scenario_p.set_defaults(func=cmd_new_scenario)

    ingest_p = sub.add_parser("ingest", help="Import raw collector output")
    ingest_p.add_argument("scenario_id")
    ingest_p.add_argument("--channel", required=True)
    ingest_p.add_argument("--input", required=True)
    ingest_p.add_argument("--format", required=True, choices=["evidence-list", "xhs-search", "xhs-detail", "xhs-comments"])
    ingest_p.add_argument("--run-id")
    ingest_p.add_argument("--batch-id")
    ingest_p.add_argument("--delta-keyword", action="append", default=[])
    ingest_p.set_defaults(func=cmd_ingest)

    normalize_p = sub.add_parser("normalize", help="Normalize raw runs into evidence.jsonl")
    normalize_p.add_argument("scenario_id")
    normalize_p.add_argument("--channel")
    normalize_p.add_argument("--batch-id")
    normalize_p.set_defaults(func=cmd_normalize)

    audit_p = sub.add_parser("audit", help="Validate normalized evidence")
    audit_p.add_argument("scenario_id")
    audit_p.set_defaults(func=cmd_audit)

    analyze_p = sub.add_parser("analyze", help="Generate Markdown analysis")
    analyze_p.add_argument("scenario_id")
    analyze_p.set_defaults(func=cmd_analyze)

    publish_p = sub.add_parser("publish-notion", help="Append a Markdown analysis file to Notion")
    publish_p.add_argument("scenario_id")
    publish_p.add_argument("--page", required=True)
    publish_p.add_argument("--source", required=True)
    publish_p.add_argument("--token")
    publish_p.add_argument("--dry-run", action="store_true")
    publish_p.set_defaults(func=cmd_publish_notion)

    delta_plan_p = sub.add_parser("delta-plan", help="Plan uncollected approved keywords for a batch")
    delta_plan_p.add_argument("scenario_id")
    delta_plan_p.add_argument("--batch-id", required=True)
    delta_plan_p.set_defaults(func=cmd_delta_plan)

    approve_delta_p = sub.add_parser("approve-delta", help="Approve a reviewed delta keyword batch")
    approve_delta_p.add_argument("scenario_id")
    approve_delta_p.add_argument("--batch-id", required=True)
    approve_delta_p.add_argument("--approved-by", required=True)
    approve_delta_p.add_argument("--note", default="")
    approve_delta_p.set_defaults(func=cmd_approve_delta)

    collect_delta_p = sub.add_parser("collect-delta", help="Collect only approved delta keywords for a batch")
    collect_delta_p.add_argument("scenario_id")
    collect_delta_p.add_argument("--batch-id", required=True)
    collect_delta_p.add_argument("--dry-run", action="store_true")
    collect_delta_p.add_argument(
        "--only-channel",
        action="append",
        default=[],
        help="Collect only this channel (repeatable). Use to retry a single blocked channel.",
    )
    collect_delta_p.add_argument(
        "--skip-channel",
        action="append",
        default=[],
        help="Skip this channel (repeatable). Use to continue past a blocked channel.",
    )
    collect_delta_p.set_defaults(func=cmd_collect_delta)

    ingest_delta_p = sub.add_parser("ingest-delta", help="Import all successful collector outputs from a delta batch")
    ingest_delta_p.add_argument("scenario_id")
    ingest_delta_p.add_argument("--batch-id", required=True)
    ingest_delta_p.add_argument(
        "--skip-channel",
        action="append",
        default=[],
        help="Skip this channel during ingest (repeatable). Use to ingest past a blocked channel.",
    )
    ingest_delta_p.set_defaults(func=cmd_ingest_delta)

    report_delta_p = sub.add_parser("report-delta", help="Summarize the impact of a delta batch")
    report_delta_p.add_argument("scenario_id")
    report_delta_p.add_argument("--batch-id", required=True)
    report_delta_p.set_defaults(func=cmd_report_delta)
    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        args.func(args)
    except (KeywordApprovalError, RuntimeError, ValueError, FileNotFoundError) as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(2) from None


if __name__ == "__main__":
    main()
