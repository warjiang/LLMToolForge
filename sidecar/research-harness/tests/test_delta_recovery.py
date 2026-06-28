import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

from research_harness.delta import (
    HARNESS_ROOT,
    _plan_paths,
    _resolve_collector_argv,
    collect_delta,
)
from research_harness.storage import read_json, write_json


APPROVAL = {"status": "approved", "approved_by": "test", "approved_at": "2026-06-22T00:00:00Z"}

STUB_OK = textwrap.dedent(
    """
    import argparse, json, sys
    from pathlib import Path
    p = argparse.ArgumentParser()
    p.add_argument("--output", required=True)
    a = p.parse_args()
    out = Path(a.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "records": [{"source_id": "x-1", "title": "ok"}],
        "meta": {"collection_status": {"blocked": False, "record_count": 1}},
    }), encoding="utf-8")
    sys.exit(0)
    """
)

STUB_BLOCK = textwrap.dedent(
    """
    import argparse, json, sys
    from pathlib import Path
    p = argparse.ArgumentParser()
    p.add_argument("--output", required=True)
    a = p.parse_args()
    out = Path(a.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    status = {"blocked": True, "primary_issue_label": "rate limit",
              "next_action": "retry later", "record_count": 0, "channel": "reddit"}
    out.write_text(json.dumps({"records": [], "meta": {"collection_status": status}}),
                   encoding="utf-8")
    out.with_suffix(".diagnosis.json").write_text(json.dumps(status), encoding="utf-8")
    print("blocked", file=sys.stderr)
    sys.exit(2)
    """
)


def _command(channel: str, script: Path, output: Path) -> dict:
    return {
        "id": channel,
        "channel": channel,
        "run_id": f"{channel}-batch",
        "output": str(output),
        "keywords": [],
        "argv": [sys.executable, str(script), "--output", str(output)],
    }


def _write_plan(root: Path, scenario: str, batch: str, commands: list[dict]) -> None:
    by_channel: dict[str, list[dict]] = {}
    for command in commands:
        by_channel.setdefault(command["channel"], []).append(command)
    json_path, _ = _plan_paths(root, scenario, batch)
    write_json(
        json_path,
        {
            "scenario_id": scenario,
            "batch_id": batch,
            "approval": APPROVAL,
            "channels": [
                {"channel": channel, "commands": cmds}
                for channel, cmds in by_channel.items()
            ],
        },
    )


class DeltaRecoveryTests(unittest.TestCase):
    def test_resolve_collector_argv_rewrites_python_and_script(self):
        argv = ["python3", "scripts/collect_reddit.py", "--output", "/x"]
        resolved = _resolve_collector_argv(argv)
        self.assertEqual(resolved[0], sys.executable)
        self.assertEqual(resolved[1], str(HARNESS_ROOT / "scripts" / "collect_reddit.py"))
        self.assertEqual(resolved[2:], ["--output", "/x"])

    def test_resolve_collector_argv_leaves_absolute_paths(self):
        argv = [sys.executable, "/abs/stub.py", "--output", "/x"]
        self.assertEqual(_resolve_collector_argv(argv), argv)

    def _setup(self, tmp: str):
        root = Path(tmp)
        scripts = root / "_stubs"
        scripts.mkdir(parents=True, exist_ok=True)
        ok_script = scripts / "ok.py"
        ok_script.write_text(STUB_OK, encoding="utf-8")
        block_script = scripts / "block.py"
        block_script.write_text(STUB_BLOCK, encoding="utf-8")
        base = root / "data" / "raw" / "todo-extraction" / "batch-1"
        commands = [
            _command("reddit", block_script, base / "reddit" / "reddit.json"),
            _command("v2ex", ok_script, base / "v2ex" / "v2ex.json"),
        ]
        _write_plan(root, "todo-extraction", "batch-1", commands)
        return root

    def test_collect_delta_blocks_and_writes_diagnosis(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self._setup(tmp)
            with self.assertRaises(RuntimeError) as ctx:
                collect_delta(root, "todo-extraction", "batch-1")
            self.assertIn("blocked at `reddit`", str(ctx.exception))
            diag = root / "data" / "raw" / "todo-extraction" / "batch-1" / "reddit" / "reddit.diagnosis.json"
            self.assertTrue(diag.exists())
            self.assertTrue(read_json(diag)["blocked"])

    def test_skip_channel_continues_past_block(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self._setup(tmp)
            log_path = collect_delta(
                root, "todo-extraction", "batch-1", skip_channels=["reddit"]
            )
            log = read_json(log_path)
            self.assertEqual(log["status"], "ok")
            self.assertEqual(log["skip_channels"], ["reddit"])
            self.assertEqual([c["channel"] for c in log["commands"]], ["v2ex"])

    def test_only_channel_targets_single_channel(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self._setup(tmp)
            with self.assertRaises(RuntimeError) as ctx:
                collect_delta(
                    root, "todo-extraction", "batch-1", only_channels=["reddit"]
                )
            self.assertIn("blocked at `reddit`", str(ctx.exception))
            # v2ex must not have run.
            v2ex_out = root / "data" / "raw" / "todo-extraction" / "batch-1" / "v2ex" / "v2ex.json"
            self.assertFalse(v2ex_out.exists())


if __name__ == "__main__":
    unittest.main()
