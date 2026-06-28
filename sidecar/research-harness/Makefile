.PHONY: test audit-todo analyze-todo collect-xhs collect-v2ex collect-appstore collect-android-markets collect-wechat-ecosystem collect-reddit collect-zhihu collect-baidu-suggest collect-5118-index collect-oceanengine-index collect-douyin-index collect-wechat-index demo-xhs demo-xhs-refresh demo-v2ex demo-appstore demo-android-markets demo-appstore-markets demo-wechat-ecosystem demo-reddit demo-zhihu demo-baidu-suggest demo-5118-index demo-oceanengine-index demo-douyin-index demo-wechat-index todo-delta-plan todo-delta-approve todo-delta-collect todo-delta-ingest todo-delta-report todo-delta-analyze

test:
	python3 -m unittest discover -s tests -v

demo-xhs:
	python3 -m research_harness init
	python3 -m research_harness ingest todo-extraction --channel xiaohongshu --format xhs-search --input /private/tmp/xhs-result.json --run-id xhs-search
	python3 -m research_harness ingest todo-extraction --channel xiaohongshu --format xhs-detail --input /private/tmp/xhs-detail-result.json --run-id xhs-detail
	python3 -m research_harness ingest todo-extraction --channel xiaohongshu --format xhs-comments --input /private/tmp/xhs-a-comments-top20.json --run-id xhs-a-comments-top20
	python3 -m research_harness normalize todo-extraction
	python3 -m research_harness audit todo-extraction
	python3 -m research_harness analyze todo-extraction

collect-v2ex:
	python3 scripts/collect_v2ex.py --output /private/tmp/v2ex-todo-extraction.json --max-search-records 10

collect-xhs:
	python3 scripts/collect_xiaohongshu.py --output /private/tmp/xhs-todo-extraction.json --search-top-n 20 --detail-top-n 8 --max-total-records 160

collect-appstore:
	python3 scripts/collect_appstore.py --output /private/tmp/appstore-todo-extraction.json --max-reviews-per-app 20 --max-total-reviews 480

collect-android-markets:
	python3 scripts/collect_android_markets.py --output /private/tmp/android-markets-todo-extraction.json --max-reviews-per-app 20

collect-wechat-ecosystem:
	python3 scripts/collect_wechat_ecosystem.py --output /private/tmp/wechat-ecosystem-todo-extraction.json --max-results-per-keyword 20 --max-article-details 20

collect-reddit:
	python3 scripts/collect_reddit.py --output /private/tmp/reddit-todo-extraction.json --comments-top-n 2 --max-total-records 60

collect-zhihu:
	python3 scripts/collect_zhihu.py --output /private/tmp/zhihu-todo-extraction.json --max-total-records 50

collect-baidu-suggest:
	python3 scripts/collect_baidu_suggest.py --output /private/tmp/baidu-suggest-todo-extraction.json --max-total-records 80

collect-5118-index:
	python3 scripts/collect_search_index.py --channel 5118-index --output /private/tmp/5118-index-todo-extraction.json $(if $(INPUT),--method export --input $(INPUT),--method browser)

collect-oceanengine-index:
	python3 scripts/collect_search_index.py --channel oceanengine-index --output /private/tmp/oceanengine-index-todo-extraction.json $(if $(INPUT),--method export --input $(INPUT),--method browser)

collect-douyin-index:
	python3 scripts/collect_search_index.py --channel douyin-index --output /private/tmp/douyin-index-todo-extraction.json $(if $(INPUT),--method export --input $(INPUT),--method browser)

collect-wechat-index:
	python3 scripts/collect_search_index.py --channel wechat-index --output /private/tmp/wechat-index-todo-extraction.json $(if $(INPUT),--method export --input $(INPUT),--method browser)

demo-v2ex: collect-v2ex
	python3 -m research_harness ingest todo-extraction --channel v2ex --format evidence-list --input /private/tmp/v2ex-todo-extraction.json --run-id v2ex-sov2ex-api
	python3 -m research_harness normalize todo-extraction
	python3 -m research_harness audit todo-extraction
	python3 -m research_harness analyze todo-extraction

demo-xhs-refresh: collect-xhs
	python3 -m research_harness ingest todo-extraction --channel xiaohongshu --format evidence-list --input /private/tmp/xhs-todo-extraction.json --run-id xhs-browser-search
	python3 -m research_harness normalize todo-extraction
	python3 -m research_harness audit todo-extraction
	python3 -m research_harness analyze todo-extraction

demo-appstore: collect-appstore
	python3 -m research_harness ingest todo-extraction --channel appstore --format evidence-list --input /private/tmp/appstore-todo-extraction.json --run-id appstore-itunes-rss
	python3 -m research_harness normalize todo-extraction
	python3 -m research_harness audit todo-extraction
	python3 -m research_harness analyze todo-extraction

demo-android-markets: collect-android-markets
	python3 -m research_harness ingest todo-extraction --channel appstore --format evidence-list --input /private/tmp/android-markets-todo-extraction.json --run-id appstore-android-markets
	python3 -m research_harness normalize todo-extraction
	python3 -m research_harness audit todo-extraction
	python3 -m research_harness analyze todo-extraction

demo-appstore-markets: collect-appstore collect-android-markets
	python3 -m research_harness ingest todo-extraction --channel appstore --format evidence-list --input /private/tmp/appstore-todo-extraction.json --run-id appstore-itunes-rss
	python3 -m research_harness ingest todo-extraction --channel appstore --format evidence-list --input /private/tmp/android-markets-todo-extraction.json --run-id appstore-android-markets
	python3 -m research_harness normalize todo-extraction
	python3 -m research_harness audit todo-extraction
	python3 -m research_harness analyze todo-extraction

demo-wechat-ecosystem: collect-wechat-ecosystem
	python3 -m research_harness ingest todo-extraction --channel wechat-ecosystem --format evidence-list --input /private/tmp/wechat-ecosystem-todo-extraction.json --run-id wechat-ecosystem-search
	python3 -m research_harness normalize todo-extraction
	python3 -m research_harness audit todo-extraction
	python3 -m research_harness analyze todo-extraction

demo-reddit: collect-reddit
	python3 -m research_harness ingest todo-extraction --channel reddit --format evidence-list --input /private/tmp/reddit-todo-extraction.json --run-id reddit-pullpush
	python3 -m research_harness normalize todo-extraction
	python3 -m research_harness audit todo-extraction
	python3 -m research_harness analyze todo-extraction

demo-zhihu: collect-zhihu
	python3 -m research_harness ingest todo-extraction --channel zhihu --format evidence-list --input /private/tmp/zhihu-todo-extraction.json --run-id zhihu-sogou-search
	python3 -m research_harness normalize todo-extraction
	python3 -m research_harness audit todo-extraction
	python3 -m research_harness analyze todo-extraction

demo-baidu-suggest: collect-baidu-suggest
	python3 -m research_harness ingest todo-extraction --channel baidu-suggest --format evidence-list --input /private/tmp/baidu-suggest-todo-extraction.json --run-id baidu-suggest-sugrec
	python3 -m research_harness normalize todo-extraction
	python3 -m research_harness audit todo-extraction
	python3 -m research_harness analyze todo-extraction

demo-5118-index: collect-5118-index
	python3 -m research_harness ingest todo-extraction --channel 5118-index --format evidence-list --input /private/tmp/5118-index-todo-extraction.json --run-id 5118-index-export
	python3 -m research_harness normalize todo-extraction
	python3 -m research_harness audit todo-extraction
	python3 -m research_harness analyze todo-extraction

demo-oceanengine-index: collect-oceanengine-index
	python3 -m research_harness ingest todo-extraction --channel oceanengine-index --format evidence-list --input /private/tmp/oceanengine-index-todo-extraction.json --run-id oceanengine-index-export
	python3 -m research_harness normalize todo-extraction
	python3 -m research_harness audit todo-extraction
	python3 -m research_harness analyze todo-extraction

demo-douyin-index: collect-douyin-index
	python3 -m research_harness ingest todo-extraction --channel douyin-index --format evidence-list --input /private/tmp/douyin-index-todo-extraction.json --run-id douyin-index-export
	python3 -m research_harness normalize todo-extraction
	python3 -m research_harness audit todo-extraction
	python3 -m research_harness analyze todo-extraction

demo-wechat-index: collect-wechat-index
	python3 -m research_harness ingest todo-extraction --channel wechat-index --format evidence-list --input /private/tmp/wechat-index-todo-extraction.json --run-id wechat-index-export
	python3 -m research_harness normalize todo-extraction
	python3 -m research_harness audit todo-extraction
	python3 -m research_harness analyze todo-extraction

todo-delta-plan:
	python3 -m research_harness delta-plan todo-extraction --batch-id $(BATCH_ID)

todo-delta-approve:
	python3 -m research_harness approve-delta todo-extraction --batch-id $(BATCH_ID) --approved-by $(APPROVED_BY)

todo-delta-collect:
	python3 -m research_harness collect-delta todo-extraction --batch-id $(BATCH_ID)

todo-delta-ingest:
	python3 -m research_harness ingest-delta todo-extraction --batch-id $(BATCH_ID)

todo-delta-report:
	python3 -m research_harness report-delta todo-extraction --batch-id $(BATCH_ID)

todo-delta-analyze:
	python3 -m research_harness normalize todo-extraction --batch-id $(BATCH_ID)
	python3 -m research_harness audit todo-extraction
	python3 -m research_harness report-delta todo-extraction --batch-id $(BATCH_ID)
	python3 -m research_harness analyze todo-extraction

audit-todo:
	python3 -m research_harness audit todo-extraction

analyze-todo:
	python3 -m research_harness analyze todo-extraction
