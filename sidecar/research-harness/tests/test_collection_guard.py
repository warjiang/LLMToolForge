import json
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

from research_harness.ingest import ingest_file


ROOT = Path(__file__).resolve().parents[1]


class CollectionGuardTests(unittest.TestCase):
    def load_guard(self):
        import importlib.util

        spec = importlib.util.spec_from_file_location("collection_guard", ROOT / "scripts" / "collection_guard.py")
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module

    def test_network_failure_blocks_collection_output(self):
        guard = self.load_guard()
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "reddit.json"
            envelope = {
                "generatedAt": "2026-06-22T00:00:00Z",
                "meta": {
                    "errors": [
                        {
                            "surface": "pullpush",
                            "query": "Slack tasks",
                            "error": "<urlopen error [Errno 8] nodename nor servname provided, or not known>",
                        }
                    ]
                },
                "records": [],
            }

            with redirect_stdout(StringIO()):
                code = guard.write_collection_output(output, envelope, channel="reddit")
            saved = json.loads(output.read_text(encoding="utf-8"))
            diagnosis = json.loads(output.with_suffix(".diagnosis.json").read_text(encoding="utf-8"))

            self.assertEqual(code, guard.EXIT_COLLECTION_BLOCKED)
            self.assertTrue(saved["meta"]["collection_status"]["blocked"])
            self.assertEqual(diagnosis["primary_issue_type"], "network_restricted")
            self.assertTrue(output.with_suffix(".diagnosis.md").exists())

    def test_login_wall_blocks_even_with_browser_probe(self):
        guard = self.load_guard()
        diagnosis = guard.diagnose_collection(
            {
                "meta": {
                    "probes": [
                        {
                            "surface": "xiaohongshu_search",
                            "query": "飞书 待办",
                            "login_or_verification_wall": True,
                            "screenshot_path": "/private/tmp/xhs.png",
                        }
                    ]
                },
                "records": [{"source_id": "1"}],
            },
            channel="xiaohongshu",
        )

        self.assertTrue(diagnosis["blocked"])
        self.assertEqual(diagnosis["primary_issue_type"], "login_or_verification_required")

    def test_ingest_refuses_blocked_collector_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            input_path = root / "blocked.json"
            input_path.write_text(
                json.dumps(
                    {
                        "generatedAt": "2026-06-22T00:00:00Z",
                        "meta": {
                            "collection_status": {
                                "blocked": True,
                                "primary_issue_label": "未登录或触发验证",
                                "next_action": "登录后重试。",
                            }
                        },
                        "records": [{"source_id": "1", "title": "x", "source_url": "https://example.com"}],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with self.assertRaises(RuntimeError):
                ingest_file(root, "todo-extraction", "xiaohongshu", input_path, "evidence-list", run_id="blocked")

    def test_xiaohongshu_login_text_with_results_is_not_wall(self):
        import importlib.util

        spec = importlib.util.spec_from_file_location(
            "collect_xiaohongshu",
            ROOT / "scripts" / "collect_xiaohongshu.py",
        )
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)

        self.assertFalse(module._is_login_or_verification_wall("首页 登录 小红书 搜索结果", 12))
        self.assertTrue(module._is_login_or_verification_wall("请先登录后查看内容", 0))

    def test_search_index_without_export_blocks_collection(self):
        import importlib.util

        spec = importlib.util.spec_from_file_location(
            "collect_search_index",
            ROOT / "scripts" / "collect_search_index.py",
        )
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)

        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "wechat-index.json"
            with redirect_stdout(StringIO()):
                code = module.main([
                    "--channel",
                    "wechat-index",
                    "--output",
                    str(output),
                    "--method",
                    "export",
                    "--keyword",
                    "微信待办",
                ])
            saved = json.loads(output.read_text(encoding="utf-8"))
            diagnosis = json.loads(output.with_suffix(".diagnosis.json").read_text(encoding="utf-8"))

            self.assertEqual(code, 2)
            self.assertTrue(saved["meta"]["collection_status"]["blocked"])
            self.assertIn(diagnosis["primary_issue_type"], {"unknown_error", "empty_result", "login_or_verification_required"})
            self.assertEqual(saved["meta"]["collector_method"], "export_fallback")

    def test_search_index_browser_probe_blocks_empty_result_without_import(self):
        import importlib.util

        spec = importlib.util.spec_from_file_location(
            "collect_search_index",
            ROOT / "scripts" / "collect_search_index.py",
        )
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)

        with tempfile.TemporaryDirectory() as tmp:
            fake_browser = Path(tmp) / "fake-browser-harness"
            fake_browser.write_text(
                "#!/bin/sh\n"
                "echo 'SEARCH_INDEX_PROBE_JSON={\"status\":\"browser_probe_completed\",\"title\":\"微信指数\",\"visible_text\":\"指数首页\"}'\n",
                encoding="utf-8",
            )
            fake_browser.chmod(0o755)
            output = Path(tmp) / "wechat-index.json"
            with redirect_stdout(StringIO()):
                code = module.main([
                    "--channel",
                    "wechat-index",
                    "--output",
                    str(output),
                    "--method",
                    "browser",
                    "--browser-command",
                    str(fake_browser),
                    "--keyword",
                    "微信待办",
                ])
            saved = json.loads(output.read_text(encoding="utf-8"))
            diagnosis = json.loads(output.with_suffix(".diagnosis.json").read_text(encoding="utf-8"))

            self.assertEqual(code, 2)
            self.assertEqual(saved["meta"]["collector_method"], "browser_harness")
            self.assertEqual(saved["meta"]["actual_capture_method"], "browser_harness_xhr_dom_probe")
            self.assertEqual(diagnosis["primary_issue_type"], "empty_result")

    def test_search_index_browser_probe_imports_generic_xhr_rows(self):
        import importlib.util

        spec = importlib.util.spec_from_file_location(
            "collect_search_index",
            ROOT / "scripts" / "collect_search_index.py",
        )
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)

        with tempfile.TemporaryDirectory() as tmp:
            fake_browser = Path(tmp) / "fake-browser-harness.py"
            fake_browser.write_text(
                "#!/usr/bin/env python3\n"
                "import json\n"
                "body = json.dumps({'records': [{'关键词': '微信待办', '指数': 1234, '日期': '2026-06-01'}]}, ensure_ascii=False)\n"
                "probe = {'status': 'browser_probe_completed', 'title': '微信指数', 'visible_text': '指数首页', "
                "'network_candidates': [{'url': 'https://index.weixin.qq.com/api?keyword=微信待办', 'body_text': body}]}\n"
                "print('SEARCH_INDEX_PROBE_JSON=' + json.dumps(probe, ensure_ascii=False))\n",
                encoding="utf-8",
            )
            fake_browser.chmod(0o755)
            output = Path(tmp) / "wechat-index.json"
            with redirect_stdout(StringIO()):
                code = module.main([
                    "--channel",
                    "wechat-index",
                    "--output",
                    str(output),
                    "--method",
                    "browser",
                    "--browser-command",
                    str(fake_browser),
                    "--keyword",
                    "微信待办",
                ])
            saved = json.loads(output.read_text(encoding="utf-8"))

            self.assertEqual(code, 0)
            self.assertFalse(saved["meta"]["collection_status"]["blocked"])
            self.assertEqual(saved["records"][0]["metrics"]["source_type"], "browser_harness_xhr")
            self.assertEqual(saved["records"][0]["metrics"]["index_value"], 1234)

    def test_search_index_imports_user_export_csv(self):
        import importlib.util

        spec = importlib.util.spec_from_file_location(
            "collect_search_index",
            ROOT / "scripts" / "collect_search_index.py",
        )
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)

        with tempfile.TemporaryDirectory() as tmp:
            export = Path(tmp) / "wechat-index.csv"
            output = Path(tmp) / "wechat-index.json"
            export.write_text("关键词,指数,日期\n微信待办,1234,2026-06-01\n", encoding="utf-8")

            with redirect_stdout(StringIO()):
                code = module.main([
                    "--channel",
                    "wechat-index",
                    "--output",
                    str(output),
                    "--input",
                    str(export),
                    "--keyword",
                    "微信待办",
                ])
            saved = json.loads(output.read_text(encoding="utf-8"))

            self.assertEqual(code, 0)
            self.assertFalse(saved["meta"]["collection_status"]["blocked"])
            self.assertEqual(saved["records"][0]["record_type"], "metric")
            self.assertEqual(saved["records"][0]["metrics"]["index_value"], 1234)
            self.assertEqual(saved["records"][0]["query"], "微信待办")


if __name__ == "__main__":
    unittest.main()
