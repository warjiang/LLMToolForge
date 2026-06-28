import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_collect_v2ex():
    spec = importlib.util.spec_from_file_location("collect_v2ex", ROOT / "scripts" / "collect_v2ex.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def load_collect_zhihu():
    spec = importlib.util.spec_from_file_location("collect_zhihu", ROOT / "scripts" / "collect_zhihu.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def load_collect_wechat_ecosystem():
    spec = importlib.util.spec_from_file_location("collect_wechat_ecosystem", ROOT / "scripts" / "collect_wechat_ecosystem.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def load_collect_xiaohongshu():
    spec = importlib.util.spec_from_file_location("collect_xiaohongshu", ROOT / "scripts" / "collect_xiaohongshu.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def load_collect_reddit():
    spec = importlib.util.spec_from_file_location("collect_reddit", ROOT / "scripts" / "collect_reddit.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def load_collect_search_index():
    spec = importlib.util.spec_from_file_location("collect_search_index", ROOT / "scripts" / "collect_search_index.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class KeywordPolicyTests(unittest.TestCase):
    def test_v2ex_notification_keyword_is_not_configured(self):
        removed_keyword = "微信消息提醒"
        matrix = json.loads((ROOT / "keyword_matrices" / "todo-extraction.json").read_text(encoding="utf-8"))
        channel = json.loads((ROOT / "channels" / "v2ex.json").read_text(encoding="utf-8"))
        collect_v2ex = load_collect_v2ex()

        self.assertNotIn(removed_keyword, matrix["channel_keywords"]["v2ex"])
        self.assertNotIn(removed_keyword, channel["crawl_plan"]["keywords"])
        self.assertNotIn(removed_keyword, collect_v2ex.load_default_keywords())
        self.assertEqual(channel["crawl_plan"]["keywords"], collect_v2ex.load_default_keywords())

    def test_wechat_reminder_is_not_a_competitor_keyword(self):
        matrix = json.loads((ROOT / "keyword_matrices" / "todo-extraction.json").read_text(encoding="utf-8"))
        competitor = next(category for category in matrix["categories"] if category["id"] == "competitor")

        self.assertNotIn("微信提醒", competitor["zh"])

    def test_appstore_collector_uses_configured_keywords(self):
        channel = json.loads((ROOT / "channels" / "appstore.json").read_text(encoding="utf-8"))
        spec = importlib.util.spec_from_file_location("collect_appstore", ROOT / "scripts" / "collect_appstore.py")
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)

        self.assertEqual(channel["crawl_plan"]["keywords"], module.load_default_keywords())

    def test_reddit_collector_uses_configured_keywords(self):
        channel = json.loads((ROOT / "channels" / "reddit.json").read_text(encoding="utf-8"))
        module = load_collect_reddit()

        self.assertEqual(channel["crawl_plan"]["keywords"], module.load_default_keywords())
        self.assertEqual(channel["crawl_plan"]["subreddits"], module.load_default_subreddits())

    def test_reddit_collector_scopes_keywords_to_relevant_subreddits(self):
        collect_reddit = load_collect_reddit()

        scopes = collect_reddit.subreddits_for_keyword(
            "Microsoft Teams action items",
            ["productivity", "Slack", "MicrosoftTeams", "discordapp"],
            3,
        )

        self.assertEqual(scopes[0], "MicrosoftTeams")
        self.assertIn("productivity", scopes)
        self.assertNotIn("discordapp", scopes)

    def test_reddit_collector_filters_fireflies_movie_reviews(self):
        collect_reddit = load_collect_reddit()

        movie_review = {
            "title": "I loved Grave of the Fireflies, and here is my review",
            "selftext": "This movie was heartbreaking.",
            "subreddit": "ghibli",
        }
        product_review = {
            "title": "Fireflies AI meeting notes review",
            "selftext": "The transcription misses action items from Zoom meetings.",
            "subreddit": "productivity",
        }

        self.assertFalse(collect_reddit.is_relevant_submission(movie_review, "Fireflies review"))
        self.assertTrue(collect_reddit.is_relevant_submission(product_review, "Fireflies review"))

    def test_reddit_collector_uses_equivalent_search_queries_for_unstable_terms(self):
        collect_reddit = load_collect_reddit()

        self.assertEqual(
            collect_reddit.search_queries_for_keyword("Discord reminders")[0],
            "Discord reminder bot",
        )
        self.assertIn(
            "Fireflies AI meeting notes",
            collect_reddit.search_queries_for_keyword("Fireflies review"),
        )

    def test_zhihu_collector_uses_configured_keywords(self):
        channel = json.loads((ROOT / "channels" / "zhihu.json").read_text(encoding="utf-8"))
        collect_zhihu = load_collect_zhihu()

        self.assertEqual(channel["crawl_plan"]["keywords"], collect_zhihu.load_default_keywords())

    def test_wechat_ecosystem_collector_uses_configured_keywords(self):
        channel = json.loads((ROOT / "channels" / "wechat-ecosystem.json").read_text(encoding="utf-8"))
        collect_wechat = load_collect_wechat_ecosystem()

        self.assertEqual(channel["crawl_plan"]["keywords"], collect_wechat.load_default_keywords())

    def test_xiaohongshu_collector_uses_configured_keywords(self):
        channel = json.loads((ROOT / "channels" / "xiaohongshu.json").read_text(encoding="utf-8"))
        collect_xhs = load_collect_xiaohongshu()

        self.assertEqual(channel["crawl_plan"]["keywords"], collect_xhs.load_default_keywords())

    def test_search_index_collectors_use_configured_keywords(self):
        collect_index = load_collect_search_index()
        for channel_id in ["5118-index", "oceanengine-index", "douyin-index", "wechat-index"]:
            with self.subTest(channel_id=channel_id):
                channel = json.loads((ROOT / "channels" / f"{channel_id}.json").read_text(encoding="utf-8"))
                self.assertEqual(channel["crawl_plan"]["keywords"], collect_index.load_default_keywords(channel_id))
                self.assertEqual(channel["collector"], "browser-harness-xhr-dom-download")
                self.assertIn("browser-harness", " ".join(channel["crawl_plan"]["method_order"]))

    def test_wechat_ecosystem_sogou_parser_keeps_source_fields(self):
        collect_wechat = load_collect_wechat_ecosystem()
        page_html = """
        <ul class="news-list">
          <li id="sogou_vr_11002601_box_0">
            <div class="txt-box">
              <h3><a target="_blank" href="http://mp.weixin.qq.com/s?__biz=abc&amp;mid=1">微信群待办怎么整理</a></h3>
              <p class="txt-info">客户跟进、报价和发货事项容易被群消息淹没。</p>
              <div class="s-p"><span class="all-time-y2">效率工具研究所</span><span class="s2"><script>document.write(timeConvert('1780272000'))</script></span></div>
            </div>
          </li>
        </ul>
        """

        records = collect_wechat.parse_sogou_results(page_html, "微信群待办", "https://weixin.sogou.com/weixin?type=2", 10)

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["title"], "微信群待办怎么整理")
        self.assertEqual(records[0]["source_url"], "http://mp.weixin.qq.com/s?__biz=abc&mid=1")
        self.assertEqual(records[0]["query"], "微信群待办")
        self.assertIn("客户跟进", records[0]["body"])
        self.assertEqual(records[0]["metrics"]["account_name"], "效率工具研究所")
        self.assertEqual(records[0]["metrics"]["indexed_date"], "2026-06-01")
        self.assertTrue(records[0]["extra"]["search_result_only"])


if __name__ == "__main__":
    unittest.main()
