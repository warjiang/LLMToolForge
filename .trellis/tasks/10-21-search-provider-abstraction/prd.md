# Built-in Web providers and exclusive Web sources

## Goal

Provide one independent built-in Web capability for agents, exposing
`web_search` and `web_fetch` through a shared provider chain (local, DeepSeek,
Tavily, and future providers). Each provider's credentials are configured once
and reused by both operations. For each Agent/session, exactly one Web source is
active: the built-in Web tools, one designated MCP Web server, or none. Equivalent
built-in and MCP tools are never injected together.

## Background / why

- The current app exposes local Web Search/Web Fetch as MCP-shaped builtins in
  `builtinLocal.ts`, while General/ResearchAgent separately receive an internal
  `web_fetch`. This creates duplicate tool surfaces and leaves the internal agent
  without an internal `web_search`.
- The new built-in Web capability must not inherit configuration ownership from
  those MCP cards. It is an internal agent capability with its own settings and
  lifecycle.
- The existing bundled MCP Web Search/Web Fetch entries are legacy compatibility
  surfaces. They are not provider configuration stores and must not be loaded
  alongside the new internal Web tools.
- The local scraper is brittle (HTML parsing, no API key, blocked/empty results)
  and produces large, noisy page dumps — a contributor to the earlier
  `504 status code (no body)` accumulation problem.
- Professional APIs (DeepSeek, Tavily) return clean, AI-optimized results but
  require API keys.

## Scope

In scope:
- Add internal `web_search` alongside the existing internal `web_fetch`; both
  use one shared built-in provider configuration and provider chain.
- Providers: `local` (existing Rust path), `deepseek`, `tavily`.
- One provider order and one credential value per provider, reused by search and
  fetch. Provider capability metadata decides whether an adapter participates in
  a particular operation.
- **Env-gated provider activation**: exclude a keyed provider from the active
  chain when its required env is missing, while keeping the existing tool names
  registered.
- Per-provider result normalization into the current `WebSearchItem` /
  `WebFetchResponse` shapes.
- Hard per-call output budgets covering normalized fields, links, details, and
  final model-facing text, not only page body content.
- A dedicated built-in Web settings surface, independent of the MCP page.
- An explicit MCP-server flag identifying specialized external Web tool sources.
- A per-Agent/session mutually exclusive Web source selector:
  `builtin` / `mcp(serverId)` / `off`.
- Runtime de-duplication so only the selected Web source is injected.

Out of scope (this task):
- New Rust commands (external providers use the existing `httpFetch` TS path).
- Automatic semantic classification of arbitrary MCP tools by tool name. An MCP
  Web source is explicitly designated by server id.
- Supporting multiple MCP Web sources simultaneously for one Agent/session.
- Fixing the broader multi-call accumulation / concurrency problem (tracked
  separately; this task guarantees only a hard bound for each individual result).
- Moving built-in provider secrets into an encrypted credential vault. This task
  uses a dedicated local settings store, discloses its plaintext local persistence,
  and never logs or echoes credentials.

## Requirements

### R1 — Provider abstraction
- Search and fetch each have a small adapter interface. Each concrete provider
  (local/deepseek/tavily) implements it and normalizes its payload into the
  current internal shapes.

### R2 — One built-in provider configuration
- Built-in Web has one ordered provider chain, e.g.
  `deepseek,tavily,local`. Search and fetch reuse the same provider order and
  credentials; users never enter the same API key separately for each operation.
- A provider declares supported capabilities (`search`, `fetch`, or both).
  Resolution filters the shared order by the requested capability before
  applying credential gating.
- The operation tries eligible providers in order and falls back on
  error/soft-miss, ending on the always-available local adapter.
- Runtime order normalization is authoritative: deduplicate known configured ids,
  append newly introduced catalog providers that are absent from an older saved
  order, and force `local` exactly once at the end. Malformed persisted config
  must not remove the local fallback.
- Configuration is persisted by a dedicated built-in Web settings store, not by
  `McpServer.env` or the MCP Web Search/Web Fetch cards.

### R3 — Env-gated provider activation
- A provider that requires an env var (e.g. `DEEPSEEK_API_KEY`,
  `TAVILY_API_KEY`) is only included in the active chain when that env is
  present and non-empty.
- The internal `web_search` / `web_fetch` tools retain stable names and schemas;
  provider activation is internal and does not churn the model tool schema.
- Because canonical order always contains keyless `local`, search/fetch always
  retain at least one usable provider.

### R4 — Result normalization
- DeepSeek/Tavily search results map to `WebSearchItem { title, url, snippet }`;
  DeepSeek `summary` is preferred for the model-facing body when available.
- DeepSeek/Tavily fetch/extract map to `WebFetchResponse` (`text` = page/markdown
  content, `status`, `mode` = provider id, `links` best-effort/empty).

### R5 — Bounded output
- Normalize `limit` to 1–20 (default 8). Search providers do not request full page
  bodies, cap each normalized title/URL/snippet field, and cap final model-facing
  search text at 20,000 characters.
- Fetch keeps the existing 40,000-character default body budget, but clamps
  caller-provided `maxChars` to a hard 40,000-character maximum. Links and their
  fields are bounded, and final model-facing fetch text is capped at 48,000
  characters including header, suffix, and links.
- Provider error bodies are capped at 4,096 characters. The normalized `details`
  payload contains only bounded fields, so hidden tool details cannot bypass the
  per-call limit.

### R6 — Backward compatibility
- With no new env configured, behavior is identical to today: local provider
  only, stable internal tool parameters, same normal and empty-result formatting,
  and fetch still forwards `timeoutMs`.
- Existing agents with internal `web_fetch` and no explicit Web source migrate to
  `builtin`; agents without Web tools migrate to `off`. Legacy bundled Web MCP ids
  are normalized to `builtin`. User-defined MCP servers are never inferred as Web
  sources: the user marks them explicitly before choosing `mcp(serverId)`.
- The hard output ceilings are an intentional safety constraint: requests above
  the ceilings are clamped rather than preserving previously unbounded output.
- `render=true` preserves its existing meaning (authenticated in-app webview with
  local HTTP fallback) and therefore bypasses external providers.
- Tool descriptions are updated to provider-neutral wording. They must no longer
  claim that default fetch is always headless HTTP or that search never uses an
  API key; render semantics and output constraints remain explicit.

### R7 — Dedicated built-in Web settings UI
- Settings contains one **Built-in Web Tools** configuration surface, independent
  of the MCP page. It is not a raw `KEY=VALUE` textarea.
- The set of supported providers is **code-owned (a preset catalog)**. Users
  never type provider ids or env key names.
- The editor lists each provider once with display name, supported capabilities,
  short description, and one secret input per required credential. A DeepSeek or
  Tavily key is entered once and reused for both search and fetch.
- The keyless local provider is always-on and pinned last.
- A provider participates when its required key(s) are filled (keyless `local`
  always participates). Users may reorder priority via a simple control
  (drag or up/down); a sensible default order applies when untouched.
- The editor is controlled by its Settings card/dialog: the parent owns the draft
  config, receives every key/order change, and atomically saves that draft.
- Saving preserves unknown env entries for forward compatibility, overwrites the
  normalized order key, and removes a known credential key when the corresponding
  secret input is cleared.
- The UI discloses that keys are stored locally without encryption.

### R8 — Mutually exclusive Web tool source
- `WebToolSource` is configured per reusable Agent definition and per ad-hoc chat
  session: `builtin`, `mcp(serverId)`, or `off`.
- A user-defined MCP server can be marked as a **Web tool source candidate** in
  its MCP configuration. Only marked, installed servers appear in the Web source
  selector. This is explicit configuration; runtime does not guess from tool
  names/descriptions.
- `builtin` injects exactly the internal `web_search` and `web_fetch` tools and
  injects no designated MCP Web source.
- `mcp(serverId)` injects the selected MCP server's Web tools and removes internal
  `web_search` / `web_fetch` from that Agent's tool set.
- `off` injects neither built-in nor designated MCP Web tools.
- Only one MCP server can be designated as the Web source. The existing generic
  MCP selection remains available for unrelated capabilities, but all servers
  marked as Web source candidates are excluded from the generic MCP selector and
  managed only by this Web source selector.
- The legacy bundled MCP Web Search/Web Fetch entries are removed from normal
  selection (or migrated/hidden) once the equivalent internal tools exist.
- General Agent and ResearchAgent default to `builtin`; other existing agents use
  the migration rule in R6.

### R9 — Cancellation, timeout, and provider errors
- Caller cancellation is terminal. An aborted call must not fall through to a
  later provider or launch background local/external work after the tool result
  has been rejected.
- Fetch preserves `timeoutMs` as a per-provider-attempt deadline: default 20,000
  ms, clamped to 1,000–60,000 ms. A provider timeout is fallback-eligible; caller
  abort is not.
- External adapters reject non-2xx responses and malformed payloads. Errors expose
  provider id, HTTP status, and bounded provider code/message only; headers and
  credentials are never included.
- A structurally valid empty search result or DeepSeek empty fetch content is a
  successful soft miss and is retained while fallback continues. Tavily
  `failed_results` for the requested URL is a provider error, not a soft miss.
- If no provider returns non-empty data but at least one provider produced a soft
  miss, return the last soft miss. If every attempt is an error, throw the last
  bounded provider error.

## Constraints

- Minimal change: concentrate logic in the tools layer; reuse `httpFetch`,
  existing Rust local commands, existing Agent/session settings patterns, and a
  small dedicated built-in Web settings store.
- Keep stable internal tool identities/parameters. Update descriptions where
  needed so they accurately describe provider routing and render behavior.
- Chinese-first user-facing strings; keep EN fallback where UI strings exist.
- Secrets are stored once in the dedicated built-in Web settings store
  (plaintext localStorage-backed). The editor labels inputs as masked, discloses
  that values are stored locally without encryption, and never logs key values.
- In browser-only dev, external calls may be blocked by CORS and local Tauri
  commands are unavailable. Live-provider/fallback acceptance is desktop-only;
  browser tests use mocked transport.

## Acceptance Criteria

- [ ] Internal `web_search` and `web_fetch` route through the same built-in
      provider order and credential map.
- [ ] `DEEPSEEK_API_KEY` set → DeepSeek provider participates; unset → it is
      excluded from the chain and never attempted.
- [ ] `TAVILY_API_KEY` set → Tavily provider participates; unset → excluded.
- [ ] Ordered fallback works: a failing/empty higher-priority provider falls
      through to the next, ending at `local`.
- [ ] Canonical order repairs omitted/duplicated/misplaced `local`, ignores unknown
      ids, appends newly added catalog providers to older saved orders, and keeps
      `local` exactly once at the end.
- [ ] With no provider credentials configured, built-in Web behaves local-only,
      with stable internal names/parameters and normal/empty-result formatting.
- [ ] Search/fetch return the last successful empty response when all later
      attempts fail or are empty; local-only empty search remains a normal
      “未找到” result.
- [ ] Provider payloads are normalized into `WebSearchItem` / `WebFetchResponse`.
- [ ] External non-2xx, malformed JSON/payload, and Tavily `failed_results` for
      the requested URL become bounded, credential-free provider errors.
- [ ] Structurally valid empty search and DeepSeek empty fetch content are soft
      misses; fallback continues and the last soft miss is returned only when no
      provider returns non-empty data.
- [ ] Caller abort attempts no later provider; provider timeout falls through and
      `timeoutMs` remains available to the internal/local fetch path.
- [ ] `render=true` attempts only local render/HTTP fallback and never sends the
      URL to DeepSeek or Tavily.
- [ ] Search final text is at most 20,000 characters; fetch final text is at most
      48,000 characters; fetch body `maxChars` is hard-clamped to 40,000.
- [ ] Every normalized top-level string/link field has a cap, and
      `JSON.stringify(details).length` is verified against the final details
      ceiling; composition shrinks body/links to remaining budget when needed.
- [ ] Adding a provider requires a catalog entry, adapter implementation, and
      zh/en translations, but no changes to tool wiring or editor components.
- [ ] Settings shows one Built-in Web Tools editor: each provider appears once,
      credentials are entered once and reused by search/fetch, capability badges
      describe support, local is pinned last, and order is adjustable.
- [ ] Adding a provider to the catalog makes it appear automatically as a new
      row in the editor with no component-specific wiring.
- [ ] Provider editor changes are controlled by its parent Settings surface;
      edit/reorder/clear, save, and close/reopen round-trip without stale values.
- [ ] The editor discloses plaintext local persistence; provider keys never appear
      in logs, thrown errors, or model-facing tool results.
- [ ] General Agent and ResearchAgent default to source `builtin` and receive
      exactly one internal `web_search` plus one internal `web_fetch`.
- [ ] Source `mcp(serverId)` removes both internal Web tools and injects the
      selected MCP Web server exactly once.
- [ ] Source `off` injects neither built-in Web tools nor a designated MCP Web
      server.
- [ ] External Web MCP servers are selected only through the Web source selector,
      are excluded from the generic MCP selector, and runtime de-duplicates server
      ids defensively.
- [ ] Legacy bundled MCP Web Search/Web Fetch entries are migrated/hidden and are
      never loaded alongside the internal Web tools.
- [ ] Unit/component/integration tests cover chain canonicalization and catalog
      growth, env gating, fallback/empty semantics, abort/timeout behavior,
      render routing, output budgets, HTTP/payload errors, built-in settings
      round-trip, source migration, and all three mutually exclusive injection
      modes.
- [ ] Every new test path is added to `vitest.config.ts` and is proven discoverable
      by observing an intentional red test before implementation.
- [ ] `pnpm test` and `pnpm build` pass.

## Notes

- Complex task: `prd.md` + `design.md` + `implement.md`.
- Research captured in `research/provider-apis.md`.
