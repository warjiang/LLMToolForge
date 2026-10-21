# Design: built-in Web provider routing and exclusive Web sources

## Architecture

The feature has three independent concerns:

1. **Built-in provider configuration** — one global provider order and one
   credential value per provider, shared by internal search and fetch.
2. **Web source selection** — each reusable Agent or chat session chooses exactly
   one source: built-in Web, one external MCP Web server, or off.
3. **Tool execution** — built-in tools resolve/fallback across provider adapters;
   MCP mode loads only the selected external server.

This replaces the earlier design that stored provider credentials on separate MCP
Web Search/Web Fetch cards. The MCP page no longer owns built-in provider
configuration.

## Files and boundaries

- New `src/lib/agent/tools/webProviderCatalog.ts`
  - pure provider metadata, capability flags, limits, canonical order,
    serialization, and Unicode-safe bounding helpers;
  - no `httpFetch`, Tauri, stores, or executable adapters.
- New `src/lib/agent/tools/searchProviders.ts`
  - provider interfaces/adapters, checked HTTP decoding, deadlines, cancellation,
    env gating, and fallback runner.
- New `src/store/builtinWeb.ts`
  - dedicated persisted global built-in Web configuration;
  - one provider order and one credential map.
- New `src/pages/settings/BuiltinWebSettingsCard.tsx`
  - structured provider editor on Settings;
  - credentials entered once and reused by both capabilities.
- Edited `src/lib/agent/tools/internal.ts`
  - add internal `web_search`;
  - route internal `web_search` and `web_fetch` through the shared provider layer.
- Edited `src/lib/agent/agentDefinition.ts`
  - resolve the exclusive Web source before building tools;
  - inject internal Web tools or one designated MCP server, never both.
- Edited `src/types/index.ts`, `src/types/chat.ts`
  - add Web-source configuration to Agent/session types;
  - add an MCP Web-source-candidate marker.
- Edited `src/data/chatRepository.ts`
  - persist the session Web source with a backward-compatible SQLite migration.
- Edited Agent/session configuration UI
  - one Web source selector: Built-in Web / an eligible MCP Web server / Off;
  - generic MCP selectors exclude Web-source candidates.
- Edited MCP configuration UI
  - user-defined specialized Web MCP servers can be marked as Web-source
    candidates.
- Edited `src/lib/agent/researchPrompt.ts`
  - describe the selected tool surface generically instead of assuming search is
    always MCP and fetch is always internal.
- Edited `src/lib/mcp/builtins.ts`
  - legacy bundled Web Search/Web Fetch cards are hidden/deprecated once migration
    is complete; they are never loaded beside the internal pair.
- Edited `vitest.config.ts`
  - explicitly register every new test file.

No Rust command changes are required.

## Core contracts

### Provider catalog

```ts
type ProviderId = "deepseek" | "tavily" | "local";
type WebCapability = "search" | "fetch";

interface RequiredEnvMeta {
  key: string;
  labelKey: string;
}

interface ProviderMeta {
  id: ProviderId;
  displayName: string;
  descriptionKey: string;
  capabilities: readonly WebCapability[];
  requiredEnv: readonly RequiredEnvMeta[];
  supportsRender: boolean;
}
```

There is one `WEB_PROVIDER_CATALOG`, not separate Search/Fetch catalogs. Runtime
filters it by capability:

```ts
eligible = catalog.filter((provider) =>
  provider.capabilities.includes(operation)
);
```

DeepSeek, Tavily, and local currently support both capabilities. The shape also
supports future search-only or fetch-only providers without duplicating
credentials or order.

### Built-in provider configuration

```ts
interface BuiltinWebConfig {
  providerOrder: ProviderId[];
  credentials: Record<string, string>;
}
```

- Persisted in `useBuiltinWebStore` under a dedicated localStorage key.
- `providerOrder` is canonicalized: known non-local ids, first-seen/deduplicated;
  new catalog ids appended; local exactly once at the end.
- Credentials are keyed by catalog-owned env names, but users never type those
  names.
- Unknown credential entries are preserved for forward compatibility.
- Clearing a known secret removes its key.
- Values remain plaintext local persistence in this task; the UI discloses this.

The adapter layer receives a read-only env-shaped projection:

```ts
providerEnv = { ...config.credentials };
```

This keeps env-gated provider activation while avoiding separate Search/Fetch env
records.

### Web source

```ts
type WebToolSource =
  | { kind: "builtin" }
  | { kind: "mcp"; serverId: string }
  | { kind: "off" };
```

`AgentDefinition.webToolSource?` and
`ChatSessionSettings.webToolSource` carry this value.

`McpServer.webToolSourceCandidate?: boolean` marks a specialized external Web MCP
server. Runtime does not infer this role from tool names or descriptions.

## Source defaults and migration

- New General Agent and ResearchAgent sessions default to `{ kind: "builtin" }`.
- DataAgent defaults to `{ kind: "off" }`.
- New reusable agents default to `off` until the user chooses a source.
- Existing reusable Agent definitions:
  - if `enabledInternalTools` contains `web_fetch`, normalize to `builtin`;
  - otherwise, if exactly one enabled MCP server is a Web-source candidate,
    normalize to that MCP source;
  - otherwise normalize to `off`.
- Existing chat settings:
  - General/ResearchAgent sessions normalize to `builtin`;
  - other sessions use the corresponding reusable-agent/default rule.
- Legacy bundled `builtin-web-search` / `builtin-web-fetch` ids are removed from
  generic enabled-MCP lists during normalization. Their enabled state no longer
  controls built-in Web.

Normalization is centralized so old persisted objects remain readable without a
destructive data migration.

## Exclusive tool assembly

`resolveAgent` resolves `WebToolSource` before building tools.

### Built-in source

1. Remove legacy/internal Web ids from the generic internal-tool list.
2. Build ordinary internal tools.
3. Append exactly:
   - internal `web_search`;
   - internal `web_fetch`.
4. Filter all MCP servers marked `webToolSourceCandidate` from generic MCP
   activation.

### MCP source

1. Remove internal `web_search` / `web_fetch`.
2. Filter all Web-source-candidate servers from generic MCP activation.
3. Locate the selected installed/enabled candidate by `serverId`.
4. Append that server exactly once to the MCP build list.
5. If unavailable, surface a structured configuration error and inject no Web
   tools; do not silently switch to built-in because that could send data through
   an unchosen source.

### Off

Remove internal Web tools and all Web-source-candidate MCP servers.

### Defensive de-duplication

Server ids are deduplicated before `buildMcpTools`. Generic MCP selectors exclude
every Web-source-candidate server, so users cannot configure the same Web MCP in
both places.

This guarantees one configured Web source. Arbitrary general-purpose MCP servers
that happen to expose unrelated search-like tools are outside semantic
classification; specialized Web MCPs must be marked as candidates.

## Built-in tools

### Internal `web_search`

Model-visible contract:

```ts
{
  goal?: string;
  query: string;
  limit?: number; // default 8, hard max 20
}
```

### Internal `web_fetch`

Keep the existing contract:

```ts
{
  goal?: string;
  url: string;
  render?: boolean;
  maxChars?: number;
  timeoutMs?: number;
}
```

Tool descriptions become provider-neutral:

- Search explains that configured built-in providers are queried in priority
  order and that results contain title/URL/snippet.
- Fetch explains provider routing, and explicitly states that `render=true`
  forces the authenticated local webview with local HTTP fallback.

Names and parameter schemas remain stable after internal `web_search` is added.

## Provider resolution

```ts
resolveChain(operation, config, { render })
```

1. Canonicalize the single global order.
2. Filter by provider capability.
3. For fetch `render=true`, retain only `supportsRender`.
4. Gate keyed providers unless every required credential is non-empty.
5. Join ids to executable adapters; a missing adapter for a catalog capability is
   a development error.

Local is keyless, supports both operations, and remains last.

## Fallback and empty semantics

```ts
async function runChain<T>(chain, signal, attempt, isSoftMiss): Promise<T> {
  let lastError: unknown;
  let lastSoftMiss: T | undefined;

  for (const provider of chain) {
    throwIfCallerAborted(signal);
    try {
      const result = await attempt(provider);
      if (!isSoftMiss(result)) return result;
      lastSoftMiss = result;
    } catch (error) {
      if (isCallerAbort(error, signal)) throw error;
      lastError = error;
    }
  }

  if (lastSoftMiss !== undefined) return lastSoftMiss;
  throw lastError ?? new Error("no provider available");
}
```

Classification:

- Search `results=[]`: soft miss.
- DeepSeek fetch with valid `{ content: "" }`: soft miss.
- Local fetch with empty normalized text: soft miss.
- Tavily result for the requested URL with empty `raw_content`: soft miss.
- Tavily requested URL in `failed_results`: provider error.
- Non-2xx or malformed payload: provider error.

All-soft-miss returns the last soft miss. All-error throws the last bounded error.

## Deadlines and cancellation

- Search attempts: 15 seconds.
- Fetch: default 20 seconds, clamp caller `timeoutMs` to 1–60 seconds.
- External attempts use child `AbortController`s:
  - deadline abort -> `ProviderTimeoutError` -> fallback;
  - caller abort -> terminal `AbortError` -> no later provider.
- Timers/listeners are removed in `finally`.
- Internal tool `execute` receives the Pi caller signal and passes it through.
- `makeToolAbortable` still rejects promptly, while the underlying chain observes
  the same signal and stops rather than launching background fallback.

## Adapters

### Local

- Search: existing `invoke("web_search")`.
- Fetch: existing `invoke("web_fetch")`; forwards normalized `render`,
  `maxChars`, and `timeoutMs`.
- Only local supports render.

### DeepSeek

- Search: `POST /v1/tools/search` with
  `{ query, count, need_content: false }`.
- Fetch: `POST /v1/tools/fetch` with `{ url }`.
- Bearer `DEEPSEEK_API_KEY`.

### Tavily

- Search: `POST /search` with basic depth, one chunk per source, no raw content.
- Fetch: `POST /extract` with one URL, markdown format, and timeout in seconds.
- Bearer `TAVILY_API_KEY`.
- HTTP 200 requires checking both `results` and `failed_results`.

All external calls use `httpFetch`.

## Checked HTTP decoding

1. Read response text once with a 4,096-character diagnostic cap.
2. Non-2xx -> `ProviderHttpError(provider, status, code, boundedMessage)`.
3. 2xx -> parse as `unknown`, validate required fields with type guards.
4. Malformed data -> `ProviderPayloadError`.
5. Never include request headers, full env/config, credentials, or raw payloads in
   errors, logs, tool results, or details.

## Output budgets

Central constants:

```ts
SEARCH_LIMIT_DEFAULT = 8
SEARCH_LIMIT_MAX = 20
SEARCH_TEXT_HARD_LIMIT = 20_000
SEARCH_DETAILS_HARD_LIMIT = 20_000
FETCH_BODY_DEFAULT = 40_000
FETCH_BODY_HARD_LIMIT = 40_000
FETCH_TEXT_HARD_LIMIT = 48_000
FETCH_DETAILS_HARD_LIMIT = 48_000
FETCH_LINKS_BUDGET = 6_000
PROVIDER_ERROR_BODY_LIMIT = 4_096
```

- Cap every top-level string (`query`, `title`, `url`, `finalUrl`, mode) and every
  result/link field.
- Search accumulation stops before the details budget is exceeded.
- Fetch body uses the remaining details budget after fixed fields and links.
- Links are capped by count, individual fields, and aggregate budget.
- After normalization, assert/trim until
  `JSON.stringify(details).length <= DETAILS_HARD_LIMIT`; this accounts for JSON
  syntax and escaping overhead.
- Compose model-facing text from bounded details and apply the final text cap.
- `truncated=true` whenever any stage shortens content.

## Settings UI

### Built-in Web settings

Add `BuiltinWebSettingsCard` to Settings:

- one row each for DeepSeek, Tavily, Local;
- capability badges: Search / Fetch;
- one masked key input per provider;
- up/down priority controls; Local fixed last;
- active/inactive state derived from credential completeness;
- plaintext-local-storage disclosure;
- controlled draft with Save/Cancel; no raw env names exposed.

### Web source selector

Reusable Agent dialog and chat settings expose a segmented/select control:

- Built-in Web;
- each installed/enabled MCP server marked as Web-source candidate;
- Off.

The generic MCP picker excludes all candidates. Selecting a source updates
`webToolSource`; it does not mutate generic MCP ids.

### MCP candidate flag

User-defined MCP edit dialog adds a binary “Web tool source” switch. Marked
servers move from the generic MCP picker to the Web source selector. The legacy
bundled Web cards are hidden after migration.

## Persistence

- Built-in provider config: dedicated local Zustand persisted store.
- Reusable Agent: optional `webToolSource` field in the existing serialized
  `AgentDefinition`.
- Chat session: `web_tool_source TEXT` JSON value in `session_settings`; migration
  adds the column with nullable/empty legacy state, then normalization determines
  the contextual default.
- Browser fallback state stores the same typed field.
- MCP candidate marker: optional `webToolSourceCandidate` in `McpServer`;
  user-defined MCP persistence/sync carries it with normal server metadata.

## Compatibility and rollback

- No credentials -> built-in source uses local only.
- `render=true` never sends the URL to an external provider.
- Legacy bundled MCP Web entries are normalized out of generic selections.
- Provider settings persist independently of MCP enable/disable state.
- Rollback restores old tool assembly; new optional fields and local settings are
  ignored. SQLite's added nullable column is harmless.

## Testing

- `webProviderCatalog.test.ts`
  - canonical order, catalog growth, capabilities, config round-trip;
  - all field/link/text/details budgets including serialized JSON size.
- `searchProviders.test.ts`
  - gating, capability/render filtering, fallback/soft-miss/error semantics;
  - abort vs timeout;
  - official-shape DeepSeek/Tavily fixtures and bounded credential-free errors.
- `builtin-web-settings.test.tsx`
  - one provider row/key, capability badges, reorder, clear, disclosure,
    controlled save/cancel.
- Web source UI tests
  - Built-in/MCP/Off selection;
  - candidate servers absent from generic MCP picker;
  - source resets without stale values.
- Agent resolution integration tests
  - each source mode injects only its expected tool set;
  - selected MCP server appears exactly once;
  - unavailable selected server produces configuration error and no fallback;
  - legacy state migration.
- Chat repository tests
  - SQLite/fallback round-trip and default normalization.
- Add all exact paths to `vitest.config.ts`, prove discovery with an intentional
  red test, then run focused tests, full `pnpm test`, `pnpm build`, and desktop
  smoke.
