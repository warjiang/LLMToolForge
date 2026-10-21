# Implement: built-in Web provider routing and exclusive Web sources

## Approach

Strict TDD. Each behavior starts with a discoverable failing test, receives the
smallest implementation, then runs focused regression. Built-in provider
configuration, source selection, and provider execution are separate units.

## Steps

1. **Register all tests and prove discovery**
   - Add exact paths to `vitest.config.ts`:
     - `src/lib/agent/tools/webProviderCatalog.test.ts`
     - `src/lib/agent/tools/searchProviders.test.ts`
     - `src/store/tests/builtin-web.test.ts`
     - `src/data/tests/chat-web-tool-source.test.ts`
     - `src/lib/agent/tests/web-tool-source-resolution.test.ts`
     - `src/pages/settings/tests/builtin-web-settings.test.tsx`
     - `src/pages/agent/tests/web-tool-source-selector.test.tsx`
     - `src/pages/mcp/tests/web-source-candidate.test.tsx`
   - Add the first canonical-order assertion before implementation.
   - Run the focused test and full `pnpm test`; both must discover the named
     failing assertion.

2. **Build the pure provider catalog/config layer**
   - Red tests:
     - default/corrupt/duplicate/unknown order;
     - new catalog provider appended before local;
     - capability filtering;
     - one credential value reused for search/fetch;
     - cleared known key removed and unknown keys preserved;
     - all field/link/final text/serialized-details limits.
   - Create `src/lib/agent/tools/webProviderCatalog.ts`:
     - `ProviderId`, `WebCapability`, `ProviderMeta`;
     - one `WEB_PROVIDER_CATALOG`;
     - canonical order/config serializers;
     - normalization and Unicode-safe budget helpers.
   - Run catalog tests to green.

3. **Add the dedicated built-in Web store**
   - Red store tests for defaults, persisted round-trip, migration from malformed
     values, atomic save, and key clearing.
   - Create `src/store/builtinWeb.ts` using Zustand persistence:
     - one `providerOrder`;
     - one `credentials` map;
     - `saveConfig` and reset.
   - Export from `src/store/index.ts`.
   - Run store tests to green.

4. **Implement runner, deadlines, and checked decoding**
   - Red tests for:
     - first success, error to next, soft miss to next;
     - all-soft-miss returns last soft miss;
     - all-error throws last error;
     - caller abort is terminal;
     - provider timeout falls through;
     - 401/429/5xx, malformed JSON/payload, 4,096 diagnostic cap;
     - errors/results never contain credentials.
   - Create `src/lib/agent/tools/searchProviders.ts`:
     - provider interfaces and execution registries;
     - `resolveChain(operation, config, options)`;
     - cancellation-aware `runChain`;
     - `ProviderHttpError`, `ProviderPayloadError`,
       `ProviderTimeoutError`;
     - child-controller deadline helper and checked decoders.
   - Run focused tests to green.

5. **Implement local, DeepSeek, and Tavily adapters**
   - Red official-shape fixture tests for search/fetch success and partial/empty
     cases.
   - Implement local search/fetch with existing Tauri invokes.
   - Implement DeepSeek search (`need_content:false`) and fetch.
   - Implement Tavily search (one chunk, no raw content) and extract (markdown,
     bounded seconds).
   - Treat valid empty content as soft miss; Tavily requested URL in
     `failed_results` as error.
   - Bound normalized objects and assert serialized details limits.

6. **Add internal `web_search` and route both built-in tools**
   - Red tests for stable schemas, provider-neutral descriptions, unchanged fetch
     layout, local empty formatting, `render=true` local-only, and output limits.
   - Add `web_search` to internal tool ids/types.
   - Add `webSearchTool` to `internal.ts`.
   - Update internal `webFetchTool` to use the same config/runner.
   - Thread `useBuiltinWebStore.getState()` configuration into agent runtime
     dependencies without copying credentials into Agent definitions or sessions.
   - Forward caller signal and normalized timeout.

7. **Persist Web source and candidate metadata**
   - Red type/normalization tests for:
     - `builtin`, `mcp(serverId)`, `off`;
     - General/Research defaults;
     - DataAgent/off default;
     - old internal-fetch Agent -> built-in migration;
     - legacy bundled MCP ids removed.
   - Add `WebToolSource` type and normalization helper.
   - Add optional `webToolSource` to `AgentDefinition`.
   - Add `webToolSource` to `ChatSessionSettings` and default/seed logic.
   - Add `web_tool_source` migration/read/write in `chatRepository.ts`.
   - Add `webToolSourceCandidate?: boolean` to `McpServer` persistence/import
     paths.
   - Run repository/type tests to green.

8. **Implement mutually exclusive runtime assembly**
   - Red integration tests for:
     - built-in source -> exactly internal `web_search` + `web_fetch`;
     - MCP source -> no internal Web tools, selected server exactly once;
     - off -> no Web source;
     - candidate MCPs excluded from generic MCP set;
     - unavailable selected MCP -> configuration error, no silent fallback;
     - defensive server-id de-duplication.
   - Refactor `resolveAgent` into ordinary internal tools + resolved Web source +
     ordinary MCP tools.
   - Filter legacy bundled MCP Web ids and candidate servers from generic MCP
     activation.
   - Update runtime signatures so changing source/config rebuilds the runtime.
   - Update Research prompt to describe the actual selected Web tools.

9. **Build Built-in Web settings UI**
   - Red component tests for:
     - one row/key per provider;
     - capability badges;
     - masked input and plaintext-storage disclosure;
     - inactive state, reorder, immutable local last;
     - controlled Save/Cancel and reopen.
   - Create `src/pages/settings/BuiltinWebSettingsCard.tsx`.
   - Add the card to `SettingsPage`.
   - Add zh/en strings and catalog i18n parity assertions.

10. **Build source selectors and MCP candidate switch**
    - Red UI tests for:
      - Built-in / one eligible MCP / Off;
      - candidate MCP servers excluded from generic MCP picker;
      - selection persists for reusable Agent and chat session;
      - no stale source when selected server is removed/disabled.
    - Add the source control to `AgentDefDialog`.
    - Add the source control to chat settings/composer.
    - Add “Web tool source candidate” switch to user-defined MCP edit UI.
    - Hide/deprecate legacy bundled Web Search/Web Fetch cards and normalize their
      ids out of active selections.

11. **Focused regression and full verification**
    - Run every new focused test.
    - Run full `pnpm test`.
    - Run `pnpm build`.
    - Desktop smoke:
      - configure DeepSeek/Tavily keys once; verify both built-in search/fetch;
      - no key -> local only;
      - provider error/soft miss fallback;
      - render local-only;
      - timeout fallback and caller-abort terminal behavior;
      - General/Research built-in default;
      - select an MCP Web candidate -> only its tools load;
      - Off -> no Web tools;
      - generic MCP menu excludes candidates;
      - oversized payload stays within text/details limits.

## Validation

- Intentional red test discovered before implementation.
- Focused catalog/store/adapter/runtime/repository/UI tests green.
- `pnpm test` green.
- `pnpm build` green.
- Required desktop smoke green.

## Rollback points

- Provider execution: revert catalog/adapters/internal Web routing to local-only.
- Source selection: revert `WebToolSource` assembly and UI; optional persisted
  fields remain harmless.
- UI/store: remove Built-in Web Settings card/store; credentials are isolated from
  MCP configuration.
- SQLite `web_tool_source` column is additive and safe to leave after rollback.
