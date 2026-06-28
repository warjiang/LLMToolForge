import tempfile
import unittest
from pathlib import Path

from research_harness.analyze import _cell, analyze_scenario
from research_harness.storage import write_json, write_jsonl


APPROVAL = {"status": "approved", "approved_by": "test", "approved_at": "2026-06-22T00:00:00Z"}


class AnalyzeLanguageTests(unittest.TestCase):
    def test_markdown_table_cell_sanitizes_v2ex_crlf_content(self):
        value = "第一行\r\n第二行 | 第三列\t<br/>HTML"
        self.assertEqual(_cell(value, 100), "第一行 第二行 第三列 HTML")

    def test_analysis_markdown_uses_chinese_labels(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            scenario_id = "todo-extraction"
            write_json(
                root / "scenarios" / f"{scenario_id}.json",
                {
                    "id": scenario_id,
                    "name": "从聊天记录自动提取待办",
                    "validation_targets": ["验证真实工作场景"],
                    "channels": ["xiaohongshu", "v2ex"],
                    "hypotheses": ["会议纪要到行动项是强情绪、高付费意愿入口。"],
                    "keywords": {},
                },
            )
            write_json(
                root / "channels" / "xiaohongshu.json",
                {
                    "id": "xiaohongshu",
                    "name": "小红书",
                    "collector": "playwright-login-required",
                    "keyword_approval": APPROVAL,
                    "validation_targets": ["验证真实生活/工作场景", "识别场景词"],
                    "crawl_plan": {
                        "keywords": ["会议纪要 太麻烦"],
                        "search_top_n": 20,
                        "detail_top_n": 10,
                        "comments_top_n": 20,
                        "capture": ["search_notes", "note_detail", "comments"],
                    },
                    "known_gaps": [
                        {
                            "gap": "竞品词补抓不足",
                            "why_it_matters": "需要对照替代方案。",
                            "fill_method": "补抓竞品词。",
                            "priority": "P0",
                        }
                    ],
                },
            )
            write_json(
                root / "channels" / "v2ex.json",
                {
                    "id": "v2ex",
                    "name": "V2EX",
                    "collector": "api",
                    "keyword_approval": APPROVAL,
                    "validation_targets": ["验证技术早期用户需求"],
                    "crawl_plan": {
                        "keywords": ["微信 待办"],
                        "search_top_n": 10,
                        "detail_top_n": 10,
                        "comments_top_n": 20,
                        "capture": ["topic", "replies"],
                    },
                    "known_gaps": [],
                },
            )
            write_json(
                root / "keyword_matrices" / f"{scenario_id}.json",
                {
                    "scenario_id": scenario_id,
                    "approval": APPROVAL,
                    "categories": [
                        {
                            "id": "pain",
                            "name": "痛点/困扰词",
                            "zh": ["会议纪要 太麻烦"],
                            "en": ["meeting notes to tasks"],
                            "purpose": "验证场景痛点。",
                            "channels": ["xiaohongshu"],
                        }
                    ],
                    "channel_keywords": {"xiaohongshu": ["会议纪要 太麻烦"], "v2ex": ["微信 待办"]},
                },
            )
            write_json(
                root / "acceptance" / f"{scenario_id}.json",
                {
                    "scenario_id": scenario_id,
                    "overall": {"min_total_evidence": 1, "min_community_evidence": 1},
                    "channels": {
                        "xiaohongshu": {
                            "min_total_evidence": 1,
                            "min_a_evidence": 1,
                            "min_b_evidence": 1,
                            "min_noise_evidence": 1,
                            "must_have_channel_conclusion": True,
                        },
                        "v2ex": {
                            "min_total_evidence": 1,
                            "must_have_channel_conclusion": True,
                        }
                    },
                },
            )
            write_jsonl(
                root / "data" / "normalized" / scenario_id / "evidence.jsonl",
                [
                    {
                        "evidence_id": "ev_1",
                        "scenario_id": scenario_id,
                        "channel": "xiaohongshu",
                        "record_type": "comment",
                        "source_id": "note1:c1",
                        "parent_source_id": "note1",
                        "comment_id": "c1",
                        "source_url": "https://www.xiaohongshu.com/explore/note1?xsec_token=secret&xsec_source=pc_search",
                        "captured_at": "2026-06-18T00:00:00Z",
                        "query": "会议纪要 太麻烦",
                        "title": "谁家好人被会议纪要折磨到疯啊！",
                        "quote": "每周都写，写到想吐了，买了个ai写作的软件",
                        "comment_signal": "",
                        "comments_count": 0,
                        "metrics": {"like": "38", "sub_comment_count": "12"},
                        "pain_dimension": "pricing_payment",
                        "persona": "knowledge_worker",
                        "signal_strength": "paid_or_churn",
                        "confidence": "A",
                        "evidence_role": "support",
                        "source_quality": "comment",
                        "noise": False,
                        "tags": [],
                        "primary_platform": "unknown",
                        "platform_confidence": "unknown",
                        "platform_confidence_score": 0,
                        "platform_reason": "未命中明确平台词，且没有 80% 以上可靠的平台上下文。",
                        "secondary_platforms": [],
                        "raw_run_id": "test",
                    }
                ],
            )

            paths = analyze_scenario(root, scenario_id)
            summary = (root / "analysis" / scenario_id / "scenario-summary.md").read_text(encoding="utf-8")
            channel = (root / "analysis" / scenario_id / "channel-xiaohongshu.md").read_text(encoding="utf-8")
            empty_channel = (root / "analysis" / scenario_id / "channel-v2ex.md").read_text(encoding="utf-8")

            self.assertEqual(len(paths), 3)
            self.assertIn("# 场景汇总：从聊天记录自动提取待办", summary)
            self.assertIn("## 决策摘要", summary)
            self.assertIn("## 总体验收状态", summary)
            self.assertIn("## 渠道完成矩阵", summary)
            self.assertIn("[小红书](channel-xiaohongshu.md)", summary)
            self.assertIn("[V2EX](channel-v2ex.md)", summary)
            self.assertIn("| V2EX | 0 | 0 | 0 | 0 | 未采集 | [V2EX](channel-v2ex.md) |", summary)
            self.assertIn("## 三大验证问题状态", summary)
            self.assertIn("## 平台覆盖矩阵", summary)
            self.assertIn("## 平台机会评分", summary)
            self.assertIn("## 平台补证优先级", summary)
            self.assertIn("## 全局关键词矩阵", summary)
            self.assertIn("## 全局缺口摘要", summary)
            self.assertIn("## 验证信号汇总", summary)
            self.assertIn("## P0 人群候选", summary)
            self.assertIn("## 场景优先级", summary)
            self.assertIn("## 痛点假设清单", summary)
            self.assertIn("## 下一步实验计划", summary)
            self.assertIn("已付费/流失", summary)
            self.assertIn("价格/付费", summary)
            self.assertIn("按平台统计", summary)
            self.assertNotIn("| 置信度 | 类型 | 渠道 | 检索词 | 来源 | 原文/摘录 | 信号 |", summary)
            self.assertNotIn("每周都写，写到想吐了，买了个ai写作的软件", summary)
            self.assertIn("## 本渠道关键词矩阵", channel)
            self.assertIn("| 类别 | 中文关键词 | 用途 |", channel)
            self.assertNotIn("meeting notes to tasks", channel)
            self.assertIn("## 抓取方案", channel)
            self.assertIn("## 抓取范围与完成情况", channel)
            self.assertIn("## 渠道结论", channel)
            self.assertIn("## 本渠道缺口", channel)
            self.assertIn("## 代表性线索", channel)
            self.assertIn("| 置信度 | 类型 | 渠道 | 平台 | 检索词 | 来源 | 原文/摘录 | 信号 |", channel)
            self.assertIn("竞品词补抓不足", channel)
            self.assertNotIn("xsec_token=secret", summary)
            self.assertNotIn("xsec_token=secret", channel)
            self.assertIn("尚未采集到标准化线索，渠道结论待生成。", empty_channel)
            self.assertNotIn("Representative Evidence", summary)
            self.assertNotIn("Evidence by", summary)
            self.assertNotIn("Validation Signal Summary", summary)


if __name__ == "__main__":
    unittest.main()
