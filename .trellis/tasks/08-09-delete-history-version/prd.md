# Delete A Specific Data-Sync History Version

## Goal

Let the user delete a chosen history snapshot from "设置 → 数据同步 → 版本历史".
Today each row only offers "恢复到此版本" (restore); there is no way to prune an
individual snapshot, so obsolete or accidental snapshots accumulate forever.

## Background

The versioned-snapshot feature (task `07-12-data-sync-snapshots`) stores, per
backup, an immutable encrypted archive `snapshots/<id>.enc` plus a plaintext
cache `snapshots/index.json` listing snapshot metadata. `listSnapshots` prefers
the index cache and falls back to enumerating `snapshots/*.enc`.

The object-delete transport already exists end-to-end and needs **zero** new
Rust work:

- TS bridge: `storageBackend.deleteObject(config, key)` → `storage_delete_object`
- Rust command `storage_delete_object` → `S3Backend::delete` → S3 `DeleteObject`
  (already registered in `src-tauri/src/lib.rs`).

## Scope

Frontend only, additive, side-attached. No Rust changes.

## Requirements

- `deleteSnapshot(config, snapshotId)` engine function that:
  1. deletes the object `snapshots/<id>.enc`;
  2. rewrites `snapshots/index.json` to drop that entry (so the cached list
     stops showing it — the listing fallback naturally excludes it once the
     object is gone).
  - Deleting a snapshot that has no index entry still deletes the object and
    leaves a valid (possibly unchanged) index.
- `deleteSnapshot(snapshotId)` store action that runs the engine call then
  removes the entry from the in-memory `snapshots` list (optimistic refresh),
  guarded by `isConfigured()` and surfacing errors via `error`.
- UI: each `SnapshotRow` gets a destructive "删除" button next to "恢复到此版本".
  Clicking opens a `ConfirmDialog`; confirming calls the store action.
- i18n: add `sync_history_delete`, `sync_history_delete_confirm_title`,
  `sync_history_delete_confirm_desc`, `sync_history_delete_confirm_ok` to
  `zh/pages.json` and `en/pages.json`.

## Non-Goals

- No bulk delete / retention policy / "delete all".
- No CAS/conditional writes; last-writer-wins on the index cache is retained,
  consistent with the existing snapshot design.
- The delete does NOT touch `manifest.json` or `resources/*.json.enc` (the main
  backup path is unaffected).

## Acceptance Criteria

- [x] Engine `deleteSnapshot` deletes the archive object and rewrites the index
      without the removed entry; missing index is handled gracefully.
- [x] Store `deleteSnapshot` removes the row from `snapshots` on success and
      reports errors on failure; no-op when not configured.
- [x] A "删除" button + confirm dialog appears per snapshot row and is disabled
      while busy / not ready, matching the restore button's gating.
- [x] zh/en i18n keys added.
- [x] Unit tests cover: object deletion, index rewrite, and missing-index case.
- [x] `pnpm build` and `pnpm test` pass.
