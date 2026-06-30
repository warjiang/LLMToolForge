# Device ID And Settings Feature Config

## Goal

Add a local device identity and a settings-page feature configuration layer for the desktop app. The app has no user concept now, and should not introduce one.

## Requirements

- Generate one stable `deviceId` per installed device on first app startup.
- Persist `deviceId` through the existing key-value storage abstraction.
- Do not bind `deviceId` to hardware identity or user accounts.
- Drive settings-page module visibility and sidebar navigation visibility from a persisted feature config.
- Ship default features with the app: enable core settings/sidebar entries by default, while disabling storage sync, SSH, and Browser until those surfaces are ready for broad use.
- Keep unknown feature keys in persisted config for future remote configuration compatibility.
- Expose a hidden JSON editor once the displayed version has been clicked 8 times.
- Save only valid feature JSON; invalid JSON or non-boolean feature values must not persist.
- In development builds, saving hidden feature config persists without restart.
- In production builds, saving hidden feature config restarts the app.
- Pressing Esc must not close the hidden feature config modal.

## Acceptance Criteria

- [ ] First startup creates a UUID v4 `deviceId`; later reloads keep the same value.
- [ ] Settings About always displays current version and `deviceId`.
- [ ] `settings.appearance`, `settings.dataStorage`, `settings.storageSync`, and `settings.updates` can each be hidden by feature config.
- [ ] Sidebar navigation entries except Settings can each be hidden by feature config.
- [ ] About/version/hidden-config entry remains visible regardless of feature config.
- [ ] Sidebar Settings entry remains visible regardless of feature config.
- [ ] Hidden config opens once version clicks reach 8; no quick-click timing window is required.
- [ ] Saving invalid JSON shows an error and does not restart.
- [ ] Saving valid JSON in development persists config and closes the modal without restart.
- [ ] Saving valid JSON in production persists config and restarts in Tauri; browser production reloads the page.
- [ ] Pressing Esc does not close the hidden feature config modal.
- [ ] `pnpm build` passes.

## Out Of Scope

- No user account model.
- No global route guard; hidden sidebar pages remain directly reachable if opened by URL.
- No remote config fetch in this task.
