# Implementation Plan

1. Add device/feature config types, defaults, load/save/normalize/validate helpers.
2. Add a Zustand store that initializes `deviceId` and feature config once.
3. Initialize the store from `App`.
4. Refactor `SettingsPage` into feature-gated sections plus always-visible About card.
5. Add feature-gated sidebar navigation entries while keeping Settings always visible.
6. Add hidden JSON dialog with 8-click version unlock and restart behavior.
7. Add i18n strings for device ID and hidden config UI.
8. Run `pnpm build` and fix issues.
