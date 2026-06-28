import json
import tempfile
import unittest
from pathlib import Path

from research_harness.infer import infer_evidence_role, infer_platform, infer_signal_strength
from research_harness.ingest import ingest_file
from research_harness.normalize import normalize_scenario
from research_harness.storage import read_json, read_jsonl


APPROVAL = {"status": "approved", "approved_by": "test", "approved_at": "2026-06-22T00:00:00Z"}


def approve_keywords(root: Path, channel: str, keywords: list[str]) -> None:
    (root / "keyword_matrices").mkdir(parents=True, exist_ok=True)
    (root / "channels").mkdir(parents=True, exist_ok=True)
    matrix_path = root / "keyword_matrices" / "todo-extraction.json"
    matrix_path.write_text(
        json.dumps(
            {
                "scenario_id": "todo-extraction",
                "approval": APPROVAL,
                "categories": [],
                "channel_keywords": {channel: keywords},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (root / "channels" / f"{channel}.json").write_text(
        json.dumps(
            {
                "id": channel,
                "name": channel,
                "keyword_approval": APPROVAL,
                "crawl_plan": {"keywords": keywords},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


class IngestNormalizeTests(unittest.TestCase):
    def test_appstore_low_star_review_is_competitor_signal(self):
        record = {
            "record_type": "review",
            "title": "Todoist / 同步失败",
            "body": "订阅后同步还是经常失败，任务提醒也不稳定。",
            "metrics": {"rating": 2},
        }

        self.assertEqual(infer_evidence_role(record), "competitor")
        self.assertEqual(infer_signal_strength(record), "paid_or_churn")

    def test_reddit_english_workflow_signal_is_classified(self):
        record = {
            "record_type": "post",
            "title": "Is there an app that turns meeting notes into action items?",
            "body": "I am overwhelmed by Slack messages and keep forgetting customer follow ups. I currently use Notion manually.",
            "metrics": {"score": 12, "subreddit": "productivity"},
        }

        self.assertEqual(infer_signal_strength(record), "manual_workaround")

    def test_platform_inference_requires_explicit_platform_context(self):
        generic = {
            "record_type": "post",
            "title": "群消息太多，想自动提取待办",
            "body": "每天都漏掉别人派的活。",
            "query": "群消息 太多",
        }
        self.assertEqual(infer_platform(generic)["primary_platform"], "unknown")

    def test_platform_inference_prefers_wecom_over_wechat(self):
        record = {
            "record_type": "post",
            "title": "企业微信 外部群 AI 机器人",
            "body": "客户群里每天都有跟进事项。",
            "query": "企业微信 外部群 AI 机器人",
        }
        platform = infer_platform(record)

        self.assertEqual(platform["primary_platform"], "wecom")
        self.assertGreaterEqual(platform["platform_confidence_score"], 90)

    def test_platform_inference_matches_overseas_work_platforms(self):
        slack = {
            "record_type": "post",
            "title": "Too many Slack messages",
            "body": "I need reminders for customer follow ups.",
            "query": "Slack reminders",
        }
        teams = {
            "record_type": "post",
            "title": "Microsoft Teams action items",
            "body": "Can Teams meeting notes create Planner tasks?",
            "query": "Microsoft Teams action items",
        }
        bare_team = {
            "record_type": "post",
            "title": "Small teams need better task reminders",
            "body": "We forget follow ups.",
            "query": "team task reminders",
        }

        self.assertEqual(infer_platform(slack)["primary_platform"], "slack")
        self.assertEqual(infer_platform(teams)["primary_platform"], "teams")
        self.assertEqual(infer_platform(bare_team)["primary_platform"], "unknown")

    def test_platform_inference_ignores_qq_email_noise(self):
        record = {
            "record_type": "review",
            "title": "qq邮箱注册显示无效邮箱",
            "body": "无法注册账号。",
            "query": "效率工具",
        }

        self.assertEqual(infer_platform(record)["primary_platform"], "unknown")

    def test_xhs_comments_ingest_and_normalize(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            approve_keywords(root, "xiaohongshu", ["微信 待办"])
            sample = {
                "ok": True,
                "generatedAt": "2026-06-18T11:59:12Z",
                "notes": [
                    {
                        "id": "abc123",
                        "title": "1844条微信消息，AI帮我抓出今天最该处理的",
                        "url": "https://www.xiaohongshu.com/explore/abc123?xsec_token=tok",
                        "word": "微信 待办",
                        "desc": "客户报价、样品、发货机会都藏在微信里，靠自己翻不现实。",
                        "comments": [
                            {"commentId": "c1", "content": "求 skill", "like": "3"},
                            {"commentId": "c2", "content": "微信记录爬取有封号风险", "like": "2"},
                        ],
                        "fetchedCount": 2,
                        "pageCount": 1,
                    }
                ],
            }
            input_path = root / "xhs.json"
            input_path.write_text(json.dumps(sample, ensure_ascii=False), encoding="utf-8")

            raw_path = ingest_file(root, "todo-extraction", "xiaohongshu", input_path, "xhs-comments", run_id="test-run")
            self.assertTrue(raw_path.exists())

            evidence_path = normalize_scenario(root, "todo-extraction")
            rows = read_jsonl(evidence_path)
            self.assertEqual(len(rows), 3)
            row = rows[0]
            self.assertEqual(row["channel"], "xiaohongshu")
            self.assertEqual(row["confidence"], "A")
            self.assertEqual(row["record_type"], "post")
            self.assertEqual(row["query"], "微信 待办")
            self.assertIn("求 skill", row["comment_signal"])
            self.assertEqual(row["comments_count"], 2)
            self.assertFalse(row["noise"])
            comments = [item for item in rows if item["record_type"] == "comment"]
            self.assertEqual(len(comments), 2)
            self.assertEqual(comments[0]["comment_id"], "c1")
            self.assertEqual(comments[0]["confidence"], "A")
            self.assertEqual(comments[0]["quote"], "求 skill")
            self.assertEqual(comments[0]["parent_source_id"], "abc123")

    def test_noise_detection_for_chat_record_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            approve_keywords(root, "xiaohongshu", ["聊天记录 整理"])
            sample = {
                "records": [
                    {
                        "id": "noise1",
                        "title": "律师教你：把聊天记录整理成证据",
                        "source_url": "https://example.com/noise1",
                        "query": "聊天记录 整理",
                    }
                ]
            }
            input_path = root / "records.json"
            input_path.write_text(json.dumps(sample, ensure_ascii=False), encoding="utf-8")
            ingest_file(root, "todo-extraction", "xiaohongshu", input_path, "evidence-list", run_id="noise-run")
            evidence_path = normalize_scenario(root, "todo-extraction")
            row = read_jsonl(evidence_path)[0]
            self.assertEqual(row["confidence"], "N")
            self.assertTrue(row["noise"])
            self.assertEqual(row["pain_dimension"], "noise")

    def test_xhs_search_title_only_is_b_level(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            approve_keywords(root, "xiaohongshu", ["微信 待办"])
            sample = {
                "ok": True,
                "generatedAt": "2026-06-18T11:59:12Z",
                "results": {
                    "微信 待办": [
                        {
                            "id": "search1",
                            "title": "微信消息太多，有没有自动待办工具",
                            "link": "https://www.xiaohongshu.com/explore/search1",
                            "liked": "88",
                        }
                    ]
                },
            }
            input_path = root / "xhs-search.json"
            input_path.write_text(json.dumps(sample, ensure_ascii=False), encoding="utf-8")

            ingest_file(root, "todo-extraction", "xiaohongshu", input_path, "xhs-search", run_id="search-run")
            evidence_path = normalize_scenario(root, "todo-extraction")
            row = read_jsonl(evidence_path)[0]

            self.assertEqual(row["record_type"], "post")
            self.assertEqual(row["confidence"], "B")
            self.assertEqual(row["source_quality"], "title_only")
            self.assertEqual(row["quote"], "微信消息太多，有没有自动待办工具")

    def test_generic_comment_keeps_comment_source_url(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            approve_keywords(root, "v2ex", ["微信聊天自动待办"])
            sample = {
                "records": [
                    {
                        "source_id": "1220035",
                        "title": "做了一个把微信聊天自动变成待办提醒的工具",
                        "source_url": "https://www.v2ex.com/t/1220035",
                        "body": "复制整段聊天内容，AI 会自动拆分任务、识别时间并创建提醒。",
                        "query": "微信聊天自动待办",
                        "comments": [
                            {
                                "comment_id": "17752798",
                                "content": "就复制这一个动作就劝退了",
                                "source_url": "https://www.v2ex.com/t/1220035#reply3",
                            }
                        ],
                    }
                ]
            }
            input_path = root / "v2ex.json"
            input_path.write_text(json.dumps(sample, ensure_ascii=False), encoding="utf-8")

            ingest_file(root, "todo-extraction", "v2ex", input_path, "evidence-list", run_id="v2ex-run")
            evidence_path = normalize_scenario(root, "todo-extraction")
            rows = read_jsonl(evidence_path)
            comment = [row for row in rows if row["record_type"] == "comment"][0]

            self.assertEqual(comment["source_url"], "https://www.v2ex.com/t/1220035#reply3")
            self.assertEqual(comment["comment_id"], "17752798")
            self.assertEqual(comment["confidence"], "A")

    def test_search_snippet_evidence_is_b_level_and_extra_is_flattened(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            approve_keywords(root, "zhihu", ["微信待办"])
            sample = {
                "records": [
                    {
                        "source_id": "question:1:answer:2",
                        "title": "如何看待微信新出的群待办功能?",
                        "source_url": "https://www.zhihu.com/question/1/answer/2",
                        "record_type": "answer",
                        "body": "群待办便于重要消息及时提醒。",
                        "query": "微信待办",
                        "metrics": {"search_rank": 1},
                        "extra": {"search_result_only": True},
                    }
                ]
            }
            input_path = root / "zhihu.json"
            input_path.write_text(json.dumps(sample, ensure_ascii=False), encoding="utf-8")

            raw_path = ingest_file(root, "todo-extraction", "zhihu", input_path, "evidence-list", run_id="zhihu-run")
            raw = read_json(raw_path)
            self.assertTrue(raw["records"][0]["extra"]["search_result_only"])

            evidence_path = normalize_scenario(root, "todo-extraction")
            row = read_jsonl(evidence_path)[0]

            self.assertEqual(row["confidence"], "B")
            self.assertEqual(row["source_quality"], "search_snippet")

    def test_search_index_metric_normalizes_as_metric_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            approve_keywords(root, "wechat-index", ["微信待办"])
            sample = {
                "records": [
                    {
                        "source_id": "wechat-index:wechat-todo:2026-06-01",
                        "title": "微信指数：微信待办",
                        "source_url": "https://index.weixin.qq.com",
                        "record_type": "metric",
                        "query": "微信待办",
                        "body": "指数渠道=微信指数；关键词=微信待办；日期=2026-06-01；指数值=1234",
                        "metrics": {
                            "index_channel": "wechat-index",
                            "index_value": 1234,
                            "date": "2026-06-01",
                        },
                    }
                ]
            }
            input_path = root / "wechat-index.json"
            input_path.write_text(json.dumps(sample, ensure_ascii=False), encoding="utf-8")

            ingest_file(root, "todo-extraction", "wechat-index", input_path, "evidence-list", run_id="wechat-index-run")
            row = read_jsonl(normalize_scenario(root, "todo-extraction"))[0]

            self.assertEqual(row["record_type"], "metric")
            self.assertEqual(row["source_quality"], "metric_only")
            self.assertEqual(row["metrics"]["index_value"], 1234)
            self.assertEqual(row["primary_platform"], "wechat")

    def test_xhs_detail_merges_with_search_and_keeps_comments(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            approve_keywords(root, "xiaohongshu", ["会议纪要 太麻烦"])
            search_sample = {
                "ok": True,
                "generatedAt": "2026-06-18T11:59:12Z",
                "results": {
                    "会议纪要 太麻烦": [
                        {
                            "id": "note1",
                            "title": "每周会议纪要写到想吐",
                            "link": "https://www.xiaohongshu.com/explore/note1",
                            "liked": "12",
                        }
                    ]
                },
            }
            detail_sample = {
                "ok": True,
                "generatedAt": "2026-06-18T12:10:00Z",
                "tokenMap": {"note1": "tok"},
                "results": {
                    "note1": {
                        "label": "会议纪要 太麻烦",
                        "title": "每周会议纪要写到想吐",
                        "desc": "领导开完会就让我整理行动项，手动翻聊天记录很烦。",
                        "likes": "12",
                        "cmtCount": "2",
                        "comments": [
                            {"commentId": "c1", "c": "求这个 AI 待办工具", "like": "9"},
                            {"c": "我们现在只能把重点发到单人群提醒自己", "like": "4"},
                        ],
                    }
                },
            }
            search_path = root / "xhs-search.json"
            detail_path = root / "xhs-detail.json"
            search_path.write_text(json.dumps(search_sample, ensure_ascii=False), encoding="utf-8")
            detail_path.write_text(json.dumps(detail_sample, ensure_ascii=False), encoding="utf-8")

            ingest_file(root, "todo-extraction", "xiaohongshu", search_path, "xhs-search", run_id="search-run")
            ingest_file(root, "todo-extraction", "xiaohongshu", detail_path, "xhs-detail", run_id="detail-run")
            evidence_path = normalize_scenario(root, "todo-extraction")
            rows = read_jsonl(evidence_path)

            self.assertEqual(len(rows), 3)
            post = [row for row in rows if row["record_type"] == "post"][0]
            comments = [row for row in rows if row["record_type"] == "comment"]
            self.assertEqual(post["confidence"], "A")
            self.assertEqual(post["source_quality"], "full_text")
            self.assertIn("领导开完会", post["quote"])
            self.assertIn("search-run", post["raw_run_id"])
            self.assertIn("detail-run", post["raw_run_id"])
            self.assertIn("求这个 AI 待办工具", post["comment_signal"])
            self.assertEqual(comments[0]["comment_id"], "c1")
            self.assertEqual(comments[0]["confidence"], "A")
            self.assertEqual(comments[1]["comment_id"], "")
            self.assertEqual(comments[1]["confidence"], "B")

    def test_cross_run_post_dedup_uses_canonical_source_url(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            approve_keywords(root, "zhihu", ["飞书任务"])
            first = {
                "records": [
                    {
                        "title": "飞书任务怎么自动生成",
                        "source_url": "https://www.zhihu.com/question/1?utm_source=share&foo=bar",
                        "query": "飞书任务",
                        "body": "想从群消息里提取待办。",
                    }
                ]
            }
            second = {
                "records": [
                    {
                        "title": "飞书任务怎么自动生成",
                        "source_url": "https://www.zhihu.com/question/1?foo=bar&utm_medium=social",
                        "query": "飞书任务",
                        "body": "想从群消息里提取待办。补充：最好能自动提醒。",
                    }
                ]
            }
            first_path = root / "first.json"
            second_path = root / "second.json"
            first_path.write_text(json.dumps(first, ensure_ascii=False), encoding="utf-8")
            second_path.write_text(json.dumps(second, ensure_ascii=False), encoding="utf-8")

            ingest_file(root, "todo-extraction", "zhihu", first_path, "evidence-list", run_id="run-a")
            ingest_file(root, "todo-extraction", "zhihu", second_path, "evidence-list", run_id="run-b")
            rows = read_jsonl(normalize_scenario(root, "todo-extraction"))

            self.assertEqual(len(rows), 1)
            self.assertIn("run-a", rows[0]["raw_run_id"])
            self.assertIn("run-b", rows[0]["raw_run_id"])
            self.assertIn("自动提醒", rows[0]["quote"])

    def test_batch_normalize_ignores_unapproved_legacy_raw_and_sanitizes_existing_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            approve_keywords(root, "reddit", ["Slack reminders"])
            legacy_dir = root / "data" / "raw" / "todo-extraction" / "reddit"
            legacy_dir.mkdir(parents=True, exist_ok=True)
            (legacy_dir / "legacy.raw.json").write_text(
                json.dumps(
                    {
                        "run_id": "legacy",
                        "scenario_id": "todo-extraction",
                        "channel": "reddit",
                        "source_format": "evidence-list",
                        "records": [
                            {
                                "source_id": "legacy-1",
                                "title": "Motion AI review",
                                "source_url": "https://www.reddit.com/r/productivity/comments/legacy",
                                "query": "Motion AI review",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            normalized_path = root / "data" / "normalized" / "todo-extraction" / "evidence.jsonl"
            normalized_path.parent.mkdir(parents=True, exist_ok=True)
            normalized_path.write_text(
                "\n".join(
                    [
                        json.dumps(
                            {
                                "evidence_id": "old-approved",
                                "channel": "reddit",
                                "query": "Slack reminders",
                                "raw_run_id": "old-approved-run",
                            },
                            ensure_ascii=False,
                        ),
                        json.dumps(
                            {
                                "evidence_id": "old-unapproved",
                                "channel": "reddit",
                                "query": "Motion AI review",
                                "raw_run_id": "legacy",
                            },
                            ensure_ascii=False,
                        ),
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            batch_input = root / "batch.json"
            batch_input.write_text(
                json.dumps(
                    {
                        "records": [
                            {
                                "source_id": "batch-1",
                                "title": "Slack reminders for follow ups",
                                "source_url": "https://www.reddit.com/r/Slack/comments/batch1",
                                "query": "Slack reminders",
                                "body": "I need Slack reminders to avoid missing customer follow ups.",
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            ingest_file(
                root,
                "todo-extraction",
                "reddit",
                batch_input,
                "evidence-list",
                run_id="reddit-batch",
                batch_id="batch-1",
                delta_keywords=["Slack reminders"],
            )

            rows = read_jsonl(normalize_scenario(root, "todo-extraction", batch_id="batch-1"))

            self.assertIn("old-approved", {row["evidence_id"] for row in rows})
            self.assertNotIn("old-unapproved", {row["evidence_id"] for row in rows})
            self.assertIn("reddit-batch", {row["raw_run_id"] for row in rows})

    def test_batch_normalize_merges_duplicate_existing_evidence_run_ids(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            approve_keywords(root, "reddit", ["Slack reminders"])
            old_input = root / "old.json"
            batch_input = root / "batch.json"
            record = {
                "source_id": "same-post",
                "title": "Slack reminders for follow ups",
                "source_url": "https://www.reddit.com/r/Slack/comments/same-post",
                "query": "Slack reminders",
                "body": "I use Slack reminders manually.",
            }
            old_input.write_text(json.dumps({"records": [record]}, ensure_ascii=False), encoding="utf-8")
            batch_input.write_text(
                json.dumps({"records": [{**record, "body": "I need Slack reminders for customer follow ups."}]}, ensure_ascii=False),
                encoding="utf-8",
            )

            ingest_file(root, "todo-extraction", "reddit", old_input, "evidence-list", run_id="old-run")
            normalize_scenario(root, "todo-extraction")
            ingest_file(
                root,
                "todo-extraction",
                "reddit",
                batch_input,
                "evidence-list",
                run_id="batch-run",
                batch_id="batch-1",
                delta_keywords=["Slack reminders"],
            )
            rows = read_jsonl(normalize_scenario(root, "todo-extraction", batch_id="batch-1"))

            self.assertEqual(len(rows), 1)
            self.assertIn("old-run", rows[0]["raw_run_id"])
            self.assertIn("batch-run", rows[0]["raw_run_id"])
            self.assertIn("customer follow ups", rows[0]["quote"])


if __name__ == "__main__":
    unittest.main()
