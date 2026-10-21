# Research: external search/fetch provider APIs

Captured 2026-10-21 from official docs + local Tavily skill. Used to shape the
provider adapter contracts in `design.md`.

## DeepSeek — Search

- Endpoint: `POST https://api.deepseek.com/v1/tools/search`
- Auth: `Authorization: Bearer <DEEPSEEK_API_KEY>`
- Headers: `Content-Type: application/json`, `Accept: application/json`
- Request body:
  - `query` string, **required**, 1–128 Unicode chars, not all-whitespace. Supports `site:` / `-site:` / quotes.
  - `count` int, optional, default 10, range 1–50.
  - `ori_question` string, optional/nullable, 1–128 chars — original user question to sharpen intent.
  - `localization` string, optional, default "" — IP to bias localized results.
  - `need_content` bool, optional, default `false` — when `false`, `content` is always empty string.
- Response `200`: `{ results: [...] }`, each item:
  - `rerank_score` number 0–3 (>=1.5 high quality)
  - `title` string
  - `url` string
  - `snippet` string (~100–200 chars, UI-facing)
  - `summary` string (~600–800 chars, model-facing)
  - `content` string (full page body; empty unless `need_content=true`)
  - `site_name` string|null, `site_icon` string|null
  - `date` RFC3339 string|null
  - `authority` int -1..4 (>=3 authoritative)

## DeepSeek — Fetch

- Endpoint: `POST https://api.deepseek.com/v1/tools/fetch`
- Auth: `Authorization: Bearer <DEEPSEEK_API_KEY>`
- Request body: `url` string **required**, non-empty, <=8192 chars, http/https with host, no user:pass.
- Response `200`: `{ title: string, content: string }` — `content` is Markdown.

> Billing/error handling: see https://api-docs.deepseek.com/zh-cn/guides/search

## Tavily

Refs:

- `~/Workspace/KnowledgeBase/hermes-agent-workspace/skills/research/tavily-search/SKILL.md`
- https://docs.tavily.com/documentation/api-reference/endpoint/search
- https://docs.tavily.com/documentation/api-reference/endpoint/extract

- Auth: `Authorization: Bearer <TAVILY_API_KEY>`.
- Search: `POST https://api.tavily.com/search`.
  - `query` required.
  - `search_depth`: basic/advanced/fast/ultra-fast.
  - `chunks_per_source`: 1–3; controls `results[].content` size.
  - `max_results`: 0–20.
  - `include_raw_content=false` avoids full cleaned page bodies.
  - Result items include `title`, `url`, `content`, `score`, and optional
    `raw_content`.
- Extract: `POST https://api.tavily.com/extract`.
  - `urls`: string or string[], up to 20.
  - `format`: markdown/text.
  - `timeout`: number of seconds, range 1–60.
  - HTTP 200 can be partial/total per-URL failure. Successful URLs are in
    `results[]`; failures are in `failed_results[]`. Both arrays must be checked,
    and output order is not guaranteed.
  - Successful result contains `url` + `raw_content`.
- Local key lives in `~/.hermes/.env` (not auto-loaded by shell).

## Mapping to current internal shapes

Current normalized Rust/TS shapes:

- `WebSearchItem { title, url, snippet }`
- `WebFetchResponse { url, finalUrl, status, title, text, links[], truncated, mode }`

Adapters normalize provider payloads into these:

- DeepSeek/Tavily search `results[]` → `WebSearchItem[]` (title/url/snippet; prefer
  DeepSeek `summary` for the model body when present).
- DeepSeek fetch `{title, content(md)}` → `WebFetchResponse` with `text=content`,
  `status=200`, `mode="deepseek"`, `links=[]` (API returns no link list).
- Tavily extract → `WebFetchResponse` with `mode="tavily"`.

## Transport note

Frontend already has CORS-safe outbound HTTP via `src/lib/http.ts` `httpFetch`
(`@tauri-apps/plugin-http`), with `https://*/*` allowed in
`src-tauri/capabilities/default.json`. No new Rust command required for the
external providers; the local provider keeps using the existing
`invoke("web_search")` / `invoke("web_fetch")` Rust path.
