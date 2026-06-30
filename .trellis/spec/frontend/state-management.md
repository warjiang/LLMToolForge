# State Management

> How state is managed in this project.

---

## Overview

<!--
Document your project's state management conventions here.

Questions to answer:
- What state management solution do you use?
- How is local vs global state decided?
- How do you handle server state?
- What are the patterns for derived state?
-->

(To be filled by the team)

---

## State Categories

<!-- Local state, global state, server state, URL state -->

(To be filled by the team)

---

## When to Use Global State

<!-- Criteria for promoting state to global -->

(To be filled by the team)

---

## Server State

<!-- How server data is cached and synchronized -->

(To be filled by the team)

---

## App-Level Persisted Config Contracts

### Scenario: Device identity and local feature config

#### 1. Scope / Trigger

- Trigger: app-wide frontend configuration persisted through `src/data/storage.ts`.
- Use this pattern for local config that must survive restarts and may later be updated by a remote config source.

#### 2. Signatures

- `loadDeviceId(): Promise<string>`
- `loadFeatureConfig(): Promise<FeatureConfig>`
- `saveFeatureConfig(config: FeatureConfig): Promise<FeatureConfig>`
- `normalizeFeatureConfig(value: unknown): FeatureConfig`
- `validateFeatureConfig(value: unknown): FeatureConfigValidation`

#### 3. Contracts

- `FeatureConfig.version` is currently `1`.
- `FeatureConfig.features` is `Record<string, boolean>`.
- Known settings feature ids use the `settings.<module>` namespace.
- Known sidebar navigation feature ids use the `sidebar.<route>` namespace; the Settings navigation item is the fixed recovery entry and must not be hidden.
- Unknown boolean feature keys must be preserved so future remote config can round-trip through local storage before the UI knows how to render them.
- Hidden config editor save behavior depends on `import.meta.env.DEV`: development saves without restart; production saves and restarts.
- Hidden config editor must not close on Esc, so accidental keypresses do not discard config edits.

#### 4. Validation & Error Matrix

- Missing config -> use defaults.
- `version !== 1` -> hidden editor validation error; persisted load falls back to defaults.
- Missing or non-object `features` -> validation error; persisted load falls back to defaults.
- Non-boolean feature value -> validation error; persisted load ignores that key.

#### 5. Good/Base/Bad Cases

- Good: `{ "version": 1, "features": { "settings.storageSync": false, "sidebar.browser": false, "remote.future": true } }`
- Base: no stored config means every bundled feature uses `DEFAULT_FEATURES`; currently `settings.storageSync`, `sidebar.ssh`, and `sidebar.browser` are disabled by default and the others are enabled.
- Bad: `{ "version": 1, "features": { "settings.storageSync": "false" } }`

#### 6. Tests Required

- Assert first load creates and reuses `deviceId`.
- Assert default feature config matches `DEFAULT_FEATURES`, including `settings.storageSync: false`, `sidebar.ssh: false`, and `sidebar.browser: false`.
- Assert sidebar Settings stays visible even when other sidebar features are disabled.
- Assert dev save uses the "Save" label and does not restart.
- Assert production save uses the "Save & Restart" label and restarts after persisting.
- Assert Esc does not close the hidden config editor.
- Assert save/load preserves unknown boolean feature keys.
- Assert invalid editor JSON or non-boolean feature values do not persist.

#### 7. Wrong vs Correct

Wrong:

```typescript
const config = JSON.parse(raw) as FeatureConfig;
if (config.features["settings.storageSync"]) renderSync();
```

Correct:

```typescript
const config = normalizeFeatureConfig(raw);
if (isFeatureEnabled(config, "settings.storageSync")) renderSync();
```

---

## Common Mistakes

<!-- State management mistakes your team has made -->

(To be filled by the team)
