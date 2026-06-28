import unittest
from pathlib import Path
import tempfile

from research_harness.approval import KeywordApprovalError, require_keyword_approval
from research_harness.storage import write_json


APPROVAL = {"status": "approved", "approved_by": "test", "approved_at": "2026-06-22T00:00:00Z"}


def write_approved_fixture(root: Path) -> None:
    write_json(
        root / "keyword_matrices" / "todo-extraction.json",
        {
            "scenario_id": "todo-extraction",
            "approval": APPROVAL,
            "categories": [],
            "channel_keywords": {"zhihu": ["信息过载", "会议纪要整理"]},
        },
    )
    write_json(
        root / "channels" / "zhihu.json",
        {
            "id": "zhihu",
            "keyword_approval": APPROVAL,
            "crawl_plan": {"keywords": ["信息过载", "会议纪要整理"]},
        },
    )


class KeywordApprovalTests(unittest.TestCase):
    def test_missing_matrix_blocks_workflow(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(KeywordApprovalError):
                require_keyword_approval(Path(tmp), "todo-extraction", operation="analyze")

    def test_draft_matrix_blocks_workflow(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_json(
                root / "keyword_matrices" / "todo-extraction.json",
                {
                    "scenario_id": "todo-extraction",
                    "approval": {"status": "draft"},
                    "channel_keywords": {},
                },
            )

            with self.assertRaisesRegex(KeywordApprovalError, "status"):
                require_keyword_approval(root, "todo-extraction", operation="analyze")

    def test_channel_approval_is_required(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_approved_fixture(root)
            write_json(
                root / "channels" / "zhihu.json",
                {
                    "id": "zhihu",
                    "keyword_approval": {"status": "draft"},
                    "crawl_plan": {"keywords": ["信息过载"]},
                },
            )

            with self.assertRaisesRegex(KeywordApprovalError, "keyword_approval.status"):
                require_keyword_approval(root, "todo-extraction", "zhihu", operation="collect")

    def test_approved_channel_allows_configured_keywords(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_approved_fixture(root)

            require_keyword_approval(
                root,
                "todo-extraction",
                "zhihu",
                operation="collect",
                keywords=["信息过载", "会议纪要整理"],
            )

    def test_unapproved_runtime_keyword_blocks_workflow(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_approved_fixture(root)

            with self.assertRaisesRegex(KeywordApprovalError, "Unapproved keywords"):
                require_keyword_approval(
                    root,
                    "todo-extraction",
                    "zhihu",
                    operation="collect",
                    keywords=["微信好友恢复"],
                )


if __name__ == "__main__":
    unittest.main()
