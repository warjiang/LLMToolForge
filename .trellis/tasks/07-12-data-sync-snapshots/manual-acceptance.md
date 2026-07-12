# Manual Acceptance — Versioned Snapshot Backups

Desktop-only feature; run in the Tauri app (`pnpm tauri:dev`) with a configured
S3-compatible bucket + passphrase.

## Pre-req

- [ ] 设置 → 数据同步 fully configured (bucket, AK/SK, passphrase); Test connection passes.

## AC1 — Snapshot created on backup

1. Click "立即同步 / Sync now".
2. In the object browser, confirm a new `snapshots/<timestamp>_<rand>.enc` object.
3. Confirm `snapshots/index.json` gained a matching entry.
- [ ] Pass

## AC2 — Existing main path unchanged

1. Confirm `manifest.json` and `resources/*.enc` still exist and are updated in place.
2. Confirm "从远程恢复 / Restore from remote" still restores the latest data as before.
- [ ] Pass

## AC3 — History panel renders without decrypting

1. Click "版本历史 / Version history".
2. Confirm each row shows local time, device id (when present), and total item count.
- [ ] Pass

## AC4 — Index-loss recovery

1. Delete `snapshots/index.json` from the bucket.
2. Reopen / refresh the history panel.
3. Confirm snapshots still list (rebuilt from object listing; counts may show 0).
- [ ] Pass

## AC5 — Historical restore

1. Edit some config locally, sync (snapshot A). Change config again, sync (snapshot B).
2. Open history, restore snapshot A behind the confirmation dialog.
3. Confirm local collections match snapshot A; a differential value overwritten by
   B is recoverable from A.
- [ ] Pass

## AC6 — Snapshot write failure is non-fatal

1. Temporarily break snapshot write (e.g. revoke write on `snapshots/` prefix, or
   force `writeSnapshot` to throw in a dev build).
2. Run sync.
3. Confirm the primary sync still reports success; a console warning is logged.
- [ ] Pass

## AC7 — Cross-device no silent loss

1. Device A: edit + sync. Device B: edit different resource + sync.
2. Confirm each backup produced its own immutable snapshot; nothing overwritten a
   later merge/restore removed is unrecoverable — it is present in an earlier snapshot.
- [ ] Pass

## Build

- [ ] `source ~/.zshrc && pnpm build` passes (tsc + vite). ✅ verified during implementation.
