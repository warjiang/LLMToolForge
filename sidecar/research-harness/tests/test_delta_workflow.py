import tempfile
import unittest
from pathlib import Path

from research_harness.delta import (
    approve_delta_plan,
    collect_delta,
    generate_delta_plan,
    ingest_delta,
    load_delta_plan,
)
from research_harness.storage import read_json, write_json


APPROVAL = {"status": "approved", "approved_by": "test", "approved_at": "2026-06-22T00:00:00Z"}


def write_delta_fixture(root: Path) -> None:
    write_json(
        root / "scenarios" / "todo-extraction.json",
        {
            "id": "todo-extraction",
            "name": "Todo Extraction",
            "channels": ["zhihu"],
        },
    )
    write_json(
        root / "keyword_matrices" / "todo-extraction.json",
        {
            "scenario_id": "todo-extraction",
            "approval": APPROVAL,
            "categories": [],
            "channel_keywords": {"zhihu": ["信息过载", "会议纪要整理", "飞书待办"]},
        },
    )
    write_json(
        root / "channels" / "zhihu.json",
        {
            "id": "zhihu",
            "keyword_approval": APPROVAL,
            "crawl_plan": {"keywords": ["信息过载", "会议纪要整理", "飞书待办"]},
        },
    )
    write_json(
        root / "data" / "raw" / "todo-extraction" / "zhihu" / "existing.raw.json",
        {
            "run_id": "existing",
            "scenario_id": "todo-extraction",
            "channel": "zhihu",
            "source_format": "evidence-list",
            "meta": {"keywords": ["信息过载", "会议纪要整理"]},
            "records": [
                {
                    "source_id": "zhihu-1",
                    "title": "信息过载如何处理",
                    "source_url": "https://www.zhihu.com/question/1",
                    "query": "信息过载",
                    "body": "消息太多。",
                }
            ],
        },
    )


class DeltaWorkflowTests(unittest.TestCase):
    def test_delta_plan_finds_only_unattempted_keywords(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_delta_fixture(root)

            json_path, md_path = generate_delta_plan(root, "todo-extraction", "platform-20260622")
            plan = read_json(json_path)

            self.assertTrue(md_path.exists())
            zhihu = [item for item in plan["channels"] if item["channel"] == "zhihu"][0]
            self.assertEqual(zhihu["delta_keywords"], ["飞书待办"])
            self.assertEqual(zhihu["evidence_keywords"], ["信息过载"])
            self.assertEqual(zhihu["attempted_without_evidence"], ["会议纪要整理"])
            self.assertEqual(plan["approval"]["status"], "pending_review")

    def test_collect_delta_requires_batch_approval(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_delta_fixture(root)
            generate_delta_plan(root, "todo-extraction", "platform-20260622")

            with self.assertRaisesRegex(RuntimeError, "approve-delta"):
                collect_delta(root, "todo-extraction", "platform-20260622", dry_run=True)

    def test_approve_delta_allows_dry_run_without_touching_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_delta_fixture(root)
            generate_delta_plan(root, "todo-extraction", "platform-20260622")

            approve_delta_plan(root, "todo-extraction", "platform-20260622", "meiji")
            plan = load_delta_plan(root, "todo-extraction", "platform-20260622", require_approved=True)
            self.assertEqual(plan["approval"]["approved_by"], "meiji")

            log_path = collect_delta(root, "todo-extraction", "platform-20260622", dry_run=True)
            log = read_json(log_path)
            self.assertEqual(log["status"], "dry_run")
            self.assertEqual(log["commands"][0]["channel"], "zhihu")
            self.assertIn("--keyword", log["commands"][0]["argv"])

    def test_v2ex_delta_command_skips_default_topic_seeds(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_delta_fixture(root)
            matrix = read_json(root / "keyword_matrices" / "todo-extraction.json")
            matrix["channel_keywords"] = {"v2ex": ["Slack action items"]}
            write_json(root / "keyword_matrices" / "todo-extraction.json", matrix)
            write_json(
                root / "channels" / "v2ex.json",
                {
                    "id": "v2ex",
                    "keyword_approval": APPROVAL,
                    "crawl_plan": {"keywords": ["Slack action items"]},
                },
            )

            json_path, _ = generate_delta_plan(root, "todo-extraction", "platform-20260622")
            plan = read_json(json_path)
            v2ex = [item for item in plan["channels"] if item["channel"] == "v2ex"][0]

            self.assertIn("--skip-default-topics", v2ex["commands"][0]["argv"])

    def test_reddit_delta_command_uses_scoped_retries(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_delta_fixture(root)
            matrix = read_json(root / "keyword_matrices" / "todo-extraction.json")
            matrix["channel_keywords"] = {"reddit": ["Slack reminders"]}
            write_json(root / "keyword_matrices" / "todo-extraction.json", matrix)
            write_json(
                root / "channels" / "reddit.json",
                {
                    "id": "reddit",
                    "keyword_approval": APPROVAL,
                    "crawl_plan": {"keywords": ["Slack reminders"]},
                },
            )

            json_path, _ = generate_delta_plan(root, "todo-extraction", "platform-20260622")
            plan = read_json(json_path)
            reddit = [item for item in plan["channels"] if item["channel"] == "reddit"][0]
            argv = reddit["commands"][0]["argv"]

            self.assertNotIn("--all-reddit", argv)
            self.assertIn("--timeout-seconds", argv)
            self.assertIn("12", argv)
            self.assertIn("--comments-top-n", argv)
            self.assertIn("0", argv)
            self.assertIn("--subreddits-per-keyword", argv)
            self.assertIn("1", argv)
            self.assertIn("--retry-count", argv)

    def test_search_index_delta_command_uses_browser_collector(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_delta_fixture(root)
            matrix = read_json(root / "keyword_matrices" / "todo-extraction.json")
            matrix["channel_keywords"] = {"wechat-index": ["微信待办"]}
            write_json(root / "keyword_matrices" / "todo-extraction.json", matrix)
            write_json(
                root / "channels" / "wechat-index.json",
                {
                    "id": "wechat-index",
                    "keyword_approval": APPROVAL,
                    "crawl_plan": {"keywords": ["微信待办"]},
                },
            )

            json_path, _ = generate_delta_plan(root, "todo-extraction", "platform-20260622")
            plan = read_json(json_path)
            wechat_index = [item for item in plan["channels"] if item["channel"] == "wechat-index"][0]
            argv = wechat_index["commands"][0]["argv"]

            self.assertIn("scripts/collect_search_index.py", argv)
            self.assertIn("--channel", argv)
            self.assertIn("wechat-index", argv)
            self.assertIn("--method", argv)
            self.assertIn("browser", argv)
            self.assertIn("--keyword", argv)

    def test_delta_plan_omits_unsupported_channels(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_delta_fixture(root)
            matrix = read_json(root / "keyword_matrices" / "todo-extraction.json")
            matrix["channel_keywords"]["baidu-index"] = ["微信待办"]
            write_json(root / "keyword_matrices" / "todo-extraction.json", matrix)

            generate_delta_plan(root, "todo-extraction", "platform-20260622")
            json_path, _ = generate_delta_plan(root, "todo-extraction", "platform-20260622")
            plan = read_json(json_path)

            self.assertNotIn("baidu-index", [item["channel"] for item in plan["channels"]])

    def test_ingest_delta_refuses_incomplete_batch_before_partial_import(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_delta_fixture(root)
            generate_delta_plan(root, "todo-extraction", "platform-20260622")
            approve_delta_plan(root, "todo-extraction", "platform-20260622", "meiji")

            with self.assertRaisesRegex(RuntimeError, "missing output"):
                ingest_delta(root, "todo-extraction", "platform-20260622")

            raw_files = list((root / "data" / "raw" / "todo-extraction" / "zhihu").glob("zhihu-platform-20260622.raw.json"))
            self.assertEqual(raw_files, [])


if __name__ == "__main__":
    unittest.main()
