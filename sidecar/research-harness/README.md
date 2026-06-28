# Research Harness

Research Harness is a small, dependency-free ResearchOps CLI for desk research.
It keeps Git-friendly configuration, evidence, and templates as the source of
truth, then generates Markdown reports that can be reviewed in Git or published
to Notion.

## Why

Notion is good for reading and collaboration, but it becomes hard to maintain
when research spans many scenarios and channels. This harness keeps:

- scenarios in `scenarios/*.json`
- channel definitions in `channels/*.json`
- keyword matrices in `keyword_matrices/*.json`
- acceptance standards in `acceptance/*.json`
- reusable report/config templates in `templates/`
- imported raw runs in `data/raw/<scenario>/<channel>/`
- normalized evidence in `data/normalized/<scenario>/evidence.jsonl`
- generated channel and scenario reports in `analysis/<scenario>/`

`evidence.jsonl` is the contract between collection and analysis. It contains
both original posts and comment/reply rows in one table, separated by
`record_type`, so later conclusions can cite a source URL, original quote, and
comment ID instead of relying on a hand-written summary.

## Platform Revalidation

For IM/task-extraction research, normalization also infers platform fields for
each evidence row:

- `primary_platform`: `wechat`, `wecom`, `feishu_lark`, `dingtalk`, `slack`,
  `teams`, `discord`, `qq`, `telegram`, `whatsapp`, or `unknown`
- `platform_confidence`: `explicit`, `inferred_high`, or `unknown`
- `platform_confidence_score`: heuristic confidence score; only 80+ is accepted
- `platform_reason`: source context that triggered the platform decision

The rule is intentionally conservative: generic terms such as “group chat” or
“team tasks” do not imply WeChat or Microsoft Teams. If a row cannot reach the
80% confidence threshold, it stays `unknown`. This keeps platform comparison
from being biased toward WeChat when the original evidence does not say so.

After `normalize` and `analyze`, the scenario summary includes:

- platform coverage matrix: evidence counts and signal distribution by platform
- platform opportunity score: a heuristic ranking for next validation
- platform follow-up priority: which channels should be补采 with platform-specific keywords

Concrete quotes remain in each `analysis/<scenario>/channel-*.md`; the scenario
summary only keeps counts, scores, gaps, and links to channel reports.

## Collection Pause Gate

Collectors must stop the workflow when collection is abnormal. This is enforced
in code, not only by convention:

- network/DNS/sandbox failures are classified as `network_restricted`
- login, QR scan, CAPTCHA, safety check, or verification walls are classified as
  `login_or_verification_required`
- rate limits are classified as `rate_limited`
- zero importable records are classified as `empty_result`

When a collector is blocked it still writes its source JSON plus diagnosis
sidecars, then exits with a non-zero status so Makefile targets stop before
`ingest`, `normalize`, `audit`, or `analyze` can run:

```bash
/private/tmp/<channel-output>.json
/private/tmp/<channel-output>.diagnosis.json
/private/tmp/<channel-output>.diagnosis.md
```

Fix the issue first, for example logging into Xiaohongshu/WeChat in the current
Chrome, enabling the proxy, or resolving DNS/network access. Then rerun the
same `collect-*` or `demo-*` target. `ingest` also refuses collector outputs
whose `meta.collection_status.blocked` is true, so blocked data cannot be
imported accidentally.

## Incremental Keyword Collection

Do not rerun every channel just because new keywords were added. Use a delta
batch so only newly approved, previously unattempted keywords are collected:

```bash
make todo-delta-plan BATCH_ID=platform-keywords-20260622
```

Review `analysis/todo-extraction/deltas/<batch>.plan.md`. It lists each
channel's configured keywords, already covered keywords, attempted-but-empty
keywords, and the exact collector commands for the delta. Collection is blocked
until the batch is explicitly approved:

```bash
make todo-delta-approve BATCH_ID=platform-keywords-20260622 APPROVED_BY=meiji
make todo-delta-collect BATCH_ID=platform-keywords-20260622
make todo-delta-ingest BATCH_ID=platform-keywords-20260622
make todo-delta-analyze BATCH_ID=platform-keywords-20260622
```

`collect-delta` uses the same pause gate as normal collectors. If any channel
hits login, verification, network, rate-limit, or empty-result blocking, the
whole batch stops and no partial result should be imported. Fix the diagnosis
first, then rerun the same batch.

Application-market delta keywords are treated as App/competitor targets, not
generic scenario search terms. iOS App Store and Android markets are collected
only for the new App targets in the approved delta batch.

## Quick Start

```bash
cd /Users/meiji/Documents/study/github/wechat/research-harness
python3 -m research_harness init
python3 -m research_harness new-scenario meeting-action-items --name "会议行动项提取" --channel xiaohongshu --channel v2ex
python3 -m research_harness ingest todo-extraction --channel xiaohongshu --format xhs-comments --input /private/tmp/xhs-a-comments-top20.json
python3 -m research_harness normalize todo-extraction
python3 -m research_harness audit todo-extraction
python3 -m research_harness analyze todo-extraction
```

The normal loop is:

1. Draft the keyword matrix first when starting a new scenario or adding a new
   channel. Include problem terms, scenario/persona terms, competitor terms,
   and noise/counter-evidence terms.
2. Stop and get explicit human approval for the keyword matrix before any
   collection, scraping, import, normalization, audit, or analysis.
3. Configure the scenario in `scenarios/<scenario>.json`.
4. Configure planned channels in `channels/*.json`.
5. Configure approved keywords and acceptance standards in `keyword_matrices/`
   and `acceptance/`.
6. Run the collector. If it pauses with a diagnosis, fix login/network/rate-limit
   first and rerun the same collector.
7. Import collector outputs with `ingest`.
8. Run `normalize`, then `audit`, then `analyze`.
9. Review `analysis/<scenario>/scenario-summary.md` for the scenario-level
   decision, and open `channel-*.md` for channel-specific evidence.

## Keyword Approval Gate

For any new research scenario or newly added crawl channel, keyword generation
is the first required deliverable. The draft should show:

- global keyword categories and the intended validation purpose of each group
- per-channel execution keywords
- negative/noise keywords that should not be counted as positive demand
- why each channel needs different wording

Do not run collectors, import raw data, normalize evidence, audit, analyze, or
publish reports until the user has confirmed the keyword matrix. If keywords are
materially changed later, repeat the approval step before re-running collection.
The runtime guard enforces this: `keyword_matrices/<scenario>.json` must contain
`approval.status="approved"` with `approved_by` and `approved_at`, and every
executed channel must contain `channels/<channel>.json` `keyword_approval` with
the same fields. Runtime `--keyword` overrides are also rejected unless each term
is already present in the approved matrix or channel crawl plan.

For the current Xiaohongshu workflow, import all available collector outputs
before normalization:

```bash
python3 -m research_harness ingest todo-extraction --channel xiaohongshu --format xhs-search --input /private/tmp/xhs-result.json --run-id xhs-search
python3 -m research_harness ingest todo-extraction --channel xiaohongshu --format xhs-detail --input /private/tmp/xhs-detail-result.json --run-id xhs-detail
python3 -m research_harness ingest todo-extraction --channel xiaohongshu --format xhs-comments --input /private/tmp/xhs-a-comments-top20.json --run-id xhs-a-comments-top20
python3 -m research_harness normalize todo-extraction
python3 -m research_harness audit todo-extraction
python3 -m research_harness analyze todo-extraction
```

Or run the same flow with:

```bash
make demo-xhs
```

For the V2EX workflow, use SOV2EX only to discover candidate topic IDs, then
fetch topic bodies and replies from V2EX official JSON APIs. The default
collector uses the local proxy `http://127.0.0.1:7890` and writes a generic
`evidence-list` file:

```bash
make collect-v2ex
python3 -m research_harness ingest todo-extraction --channel v2ex --format evidence-list --input /private/tmp/v2ex-todo-extraction.json --run-id v2ex-sov2ex-api
python3 -m research_harness normalize todo-extraction
python3 -m research_harness audit todo-extraction
python3 -m research_harness analyze todo-extraction
```

Or run the full V2EX loop with:

```bash
make demo-v2ex
```

For the application-market workflow, keep iOS and Android evidence in the same
`appstore` channel so scenario summaries can compare domestic and overseas
markets as one channel group. The iOS collector uses iTunes Search to resolve
App IDs, then imports 1-3 star reviews from the App Store RSS feeds across CN
and US stores:

```bash
make collect-appstore
python3 -m research_harness ingest todo-extraction --channel appstore --format evidence-list --input /private/tmp/appstore-todo-extraction.json --run-id appstore-itunes-rss
python3 -m research_harness normalize todo-extraction
python3 -m research_harness audit todo-extraction
python3 -m research_harness analyze todo-extraction
```

The Android-market collector imports Google Play public embedded reviews,
Tencent MyApp reviews and score distribution, Xiaomi public score pages,
Huawei AppGallery low-star comments, and vivo search/detail score metrics.
OPPO is still tracked as a domestic Android gap when its anonymous API returns
signature errors:

```bash
make collect-android-markets
python3 -m research_harness ingest todo-extraction --channel appstore --format evidence-list --input /private/tmp/android-markets-todo-extraction.json --run-id appstore-android-markets
python3 -m research_harness normalize todo-extraction
python3 -m research_harness audit todo-extraction
python3 -m research_harness analyze todo-extraction
```

Or run the full application-market loop with both iOS and Android sources:

```bash
make demo-appstore-markets
```

For the WeChat ecosystem workflow, the collector combines two sources:
browser-harness opens WeChat Search in the user's already-running Chrome, while
Sogou Weixin is used as a public official-account index fallback. Keep Chrome
logged in before running the browser path. If WeChat Search shows a login,
verification, or empty-result wall, the collector records that probe under
`meta.probes/errors` instead of fabricating evidence.

```bash
make collect-wechat-ecosystem
python3 -m research_harness ingest todo-extraction --channel wechat-ecosystem --format evidence-list --input /private/tmp/wechat-ecosystem-todo-extraction.json --run-id wechat-ecosystem-search
python3 -m research_harness normalize todo-extraction
python3 -m research_harness audit todo-extraction
python3 -m research_harness analyze todo-extraction
```

Or run the full WeChat ecosystem loop with:

```bash
make demo-wechat-ecosystem
```

This channel only collects public search results and public official-account
pages. It does not collect personal WeChat chat records, private group content,
or unauthorized comments. Use `--skip-browser` when only the Sogou Weixin
fallback should run.

For the Reddit workflow, the collector uses the PullPush public Reddit archive
because direct `reddit.com` JSON can be blocked and `REDDAPI_API_KEY` may not be
configured. It imports matching submissions plus top archived comments as a
generic `evidence-list` file:

```bash
make collect-reddit
python3 -m research_harness ingest todo-extraction --channel reddit --format evidence-list --input /private/tmp/reddit-todo-extraction.json --run-id reddit-pullpush
python3 -m research_harness normalize todo-extraction
python3 -m research_harness audit todo-extraction
python3 -m research_harness analyze todo-extraction
```

Or run the full Reddit loop with:

```bash
make demo-reddit
```

For the Zhihu workflow, anonymous direct Zhihu pages may return an anti-bot
challenge instead of article content. The default collector therefore uses
Sogou indexed results to preserve Zhihu target URLs, titles, snippets, indexed
dates, and search ranks as B-level evidence:

```bash
make collect-zhihu
python3 -m research_harness ingest todo-extraction --channel zhihu --format evidence-list --input /private/tmp/zhihu-todo-extraction.json --run-id zhihu-sogou-search
python3 -m research_harness normalize todo-extraction
python3 -m research_harness audit todo-extraction
python3 -m research_harness analyze todo-extraction
```

Or run the full Zhihu loop with:

```bash
make demo-zhihu
```

For search/index calibration, 5118指数、巨量算数、抖音指数 and 微信指数 are
modeled as metric-only channels. They are collected by the assistant through
`browser-harness` first: the collector connects to the user's already-running
Chrome, opens the index platform, searches approved keywords, then tries XHR,
DOM table/chart extraction, and platform download/import in that order.

```bash
make collect-wechat-index
```

If a site shows login, QR scan, CAPTCHA, member-only data, network limits, or an
empty result, the collector pauses and writes a diagnosis instead of importing
partial or guessed data. The user only needs to fix the blocking state, for
example logging in or passing verification in Chrome, then rerun the same
target.

CSV/JSON import remains as a fallback when browser collection is blocked or the
platform exposes a download file. The file must contain at least a keyword
column and an index/heat value column; common Chinese headers such as `关键词`
and `指数` are supported.

```bash
make collect-5118-index INPUT=/path/to/5118-export.csv
python3 -m research_harness ingest todo-extraction --channel 5118-index --format evidence-list --input /private/tmp/5118-index-todo-extraction.json --run-id 5118-index-export
python3 -m research_harness normalize todo-extraction
python3 -m research_harness audit todo-extraction
python3 -m research_harness analyze todo-extraction
```

Equivalent targets exist for:

- `make collect-5118-index`
- `make collect-oceanengine-index`
- `make collect-douyin-index`
- `make collect-wechat-index`
- `make collect-oceanengine-index INPUT=/path/to/oceanengine.csv`
- `make collect-douyin-index INPUT=/path/to/douyin.csv`
- `make collect-wechat-index INPUT=/path/to/wechat-index.csv`

These records use `record_type=metric` and `source_quality=metric_only`.
They are used to calibrate demand scale, trend, and reach keywords. They do not
prove pain strength, workaround behavior, authorization feasibility, or payment
willingness; those still need community posts, comments, app reviews, or
interviews.

Publish a generated analysis page to Notion:

```bash
python3 -m research_harness publish-notion todo-extraction \
  --page 38325bd1f1778032bfdfc910f652aed3 \
  --source analysis/todo-extraction/scenario-summary.md
```

The Notion token is resolved in this order:

1. `--token`
2. `NOTION_TOKEN`
3. `/Users/meiji/.config/meiji/key.json` at `notion_cli.token`

## Evidence Levels

- `A`: source URL + body or quote + comment/metric signal
- `B`: source URL + title or partial body
- `C`: weak title-level signal
- `N`: noise or counter-evidence

## Supported Import Formats

- `evidence-list`: a JSON list or `{ "records": [...] }` with generic records.
  V2EX uses this shape for topic rows plus nested `comments` reply rows.
- `xhs-search`: the existing Playwright search output shape:
  `{ "ok": true, "generatedAt": "...", "results": { "关键词": [...] } }`.
- `xhs-detail`: Xiaohongshu note detail output with body, metrics, token map,
  and comments keyed by note ID.
- `xhs-comments`: the existing A-level Xiaohongshu comments output shape:
  `{ "ok": true, "generatedAt": "...", "notes": [...] }`.

`normalize` merges duplicate Xiaohongshu posts across search, detail, and
comment runs. It keeps comments as separate evidence rows, while also preserving
a short comment summary on the parent post.

## Methodology

Each evidence row must preserve:

- source URL
- original quote or title
- record type (`post`, `comment`, `review`, `metric`, ...)
- parent source ID and comment ID when the row comes from a reply/comment
- channel
- scenario ID
- capture time
- confidence level
- signal strength
- inferred dimension and persona

Analysis is generated from normalized evidence, not hand-maintained in Notion.

## Reports

The default output separates decision summaries from evidence detail:

- `analysis/<scenario>/scenario-summary.md`: scenario-level acceptance,
  Go/No-Go judgment, channel completion matrix, validation signal summary,
  P0 persona/scene priority, hypothesis status, gaps, and next experiments.
  It does not repeat raw post/comment excerpts or channel-level source tables;
  it links to channel reports.
- `analysis/<scenario>/channel-<channel>.md`: channel-level validation targets,
  keyword matrix, crawl plan, acceptance status, evidence distribution,
  representative evidence, channel conclusion, gaps, and next steps.

When a channel is listed in `scenarios/<scenario>.json` but has no imported
evidence yet, `analyze` still includes it in the scenario completion matrix and
generates a placeholder `channel-<channel>.md`. This keeps the summary tied to
the research plan, not just to channels that already have data.

Standalone acceptance, gap, and keyword reports are not generated by default.
Those sections live inside the scenario and channel reports so each Markdown
file remains reviewable.

## Git Sharing

Commit reusable assets: `scenarios/`, `channels/`, `keyword_matrices/`,
`acceptance/`, `templates/`, `schemas/`, source code, tests, and docs.

Generated research snapshots under `analysis/` and `data/` can contain source
tokens, nicknames, IP labels, and user quotes. Commit them only when they are
needed for collaboration and have been reviewed for sensitive content. For
routine work, prefer committing the configs/templates/code first, then publish
selected generated Markdown to Notion when collaboration requires it.

See `docs/researchops-architecture.md` for the full source-of-truth, channel
expansion, and Git sharing model.
