# Fix external link opening from Markdown

## Goal

Opening a Markdown link in chat should hand the URL to the operating system's
default browser instead of navigating the Tauri application WebView.

## Requirements

- Left-clicking `http://` and `https://` Markdown links in agent messages opens
  the URL externally.
- The app must not navigate its own WebView to the linked page.
- The native command must reject non-web schemes such as `javascript:`,
  `file:`, and empty values.
- Non-Tauri browser development mode should keep a safe `window.open` fallback.

## Acceptance Criteria

- [ ] Rust unit coverage verifies allowed and rejected external URL schemes.
- [ ] Markdown link clicks use the native external-open command in Tauri.
- [ ] `pnpm build` passes.
- [ ] `cargo test` passes for the Tauri crate.

## Notes

- Lightweight bug fix; PRD-only task.
