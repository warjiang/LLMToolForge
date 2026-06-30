# Device ID And Settings Feature Config Design

## Architecture

- Add a frontend config owner under `src/lib/` for device identity and feature config.
- Use the existing `getStore()` abstraction so Tauri uses plugin-store and browser dev uses localStorage.
- Add a small Zustand store for async initialization and UI consumption.
- Initialize the store from `App` on startup.

## Contracts

```ts
type FeatureId =
  | "settings.appearance"
  | "settings.dataStorage"
  | "settings.storageSync"
  | "settings.updates"
  | "sidebar.dashboard"
  | "sidebar.providers"
  | "sidebar.unified"
  | "sidebar.skills"
  | "sidebar.mcp"
  | "sidebar.ssh"
  | "sidebar.tools"
  | "sidebar.browser";

interface FeatureConfig {
  version: 1;
  features: Record<string, boolean>;
}
```

- Defaults enable core settings-page and sidebar features; `settings.storageSync`, `sidebar.ssh`, and `sidebar.browser` are disabled by default.
- Normalization merges persisted features over defaults and preserves unknown keys.
- Validation rejects payloads without `version: 1`, without an object `features`, or with non-boolean feature values.

## UI Flow

- Settings page reads feature flags from the feature store.
- Sidebar reads feature flags from the same store and filters every navigation item except Settings.
- About card always renders and owns the hidden version-click entry; cumulative version clicks open the dialog once they reach 8.
- Hidden dialog edits the normalized JSON config.
- Hidden dialog prevents Esc from closing it.
- Save persists normalized config and updates store state. Development builds close the dialog without restart; production builds restart via Tauri `relaunch()` or browser `window.location.reload()`.

## Compatibility

- Existing settings behavior remains unchanged when no config exists.
- Remote config can later call the same save/normalize path before app restart.
