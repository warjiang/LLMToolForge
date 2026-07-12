# Versioned Snapshot Backups For Data Sync

## Goal

Give the "设置 → 数据同步" (Data Sync) feature a history/versioning mechanism so
that overwrite-based backup and restore can no longer silently and irrecoverably
discard configuration. Each backup keeps an immutable, timestamped, encrypted
archive of the full config set; restore can pick any historical archive, while
still defaulting to the current "restore latest" behavior.

## Background / Problem

Current remote layout (prefix `llmtoolforge`) is flat and single-generation:

```
llmtoolforge/
  manifest.json            # plaintext pointer + KDF salt + per-resource hash/updatedAt
  resources/*.json.enc     # 8 AES-256-GCM encrypted per-resource blobs (overwritten in place)
```

- `runSync` (设置 → 数据同步 → 同步) already performs a two-way per-item
  last-write-wins merge with tombstones — it is NOT a blind overwrite.
- `restoreFromRemote` (恢复) IS overwrite-based: `replaceAll` replaces local
  collections with the remote snapshot.
- Both `manifest.json` and every `resources/*.json.enc` are overwritten in place
  every sync — there is exactly one generation and no history.

Consequences:

- **G1 — No history / no rollback**: a bad merge, an accidental delete, or a
  corrupted blob cannot be rolled back; there is no audit trail.
- **G2 — Destructive restore across devices**: restoring on device B overwrites
  local collections, so device B's un-synced differential config is silently
  dropped — the exact cross-device data-loss the feature is meant to prevent.

## Decisions (locked with the user)

1. **Keep the existing backup/restore main path unchanged.** This is a minimal,
   side-attached addition, not a rewrite.
2. **No CAS / conditional writes in this task.** Rely on immutable snapshots for
   self-healing; concurrency hardening can come later.
3. **Whole-archive single file per snapshot** (`snapshots/<ts>.enc` containing all
   resources), not per-resource files.
4. **Restore default stays "restore latest"** (unchanged `restoreFromRemote`);
   restoring from a chosen historical snapshot is an added capability.

## Scope

Backend (Rust): expected **zero changes** — reuse existing `storage_*` Tauri
commands and the AES-256-GCM crypto module. All changes are frontend, side-attached
and additive.

## Requirements

- After each successful `runSync`, write one immutable encrypted archive
  `snapshots/<timestamp>_<rand>.enc` containing every synced resource payload.
- Maintain a plaintext `snapshots/index.json` listing snapshot metadata
  (id, key, createdAt, deviceId, per-resource item counts) for display without
  decryption.
- `index.json` is a cache only: when missing/stale, the snapshot list must be
  rebuildable from `storage_list_objects("snapshots/")`.
- Snapshot archives and existing `manifest.json` / `resources/*.enc` must never
  overwrite historical snapshot objects (append-only under `snapshots/`).
- Restore continues to default to "restore latest" via the unchanged
  `restoreFromRemote` path.
- Add "restore from a chosen historical snapshot": pull `snapshots/<id>.enc`,
  decrypt, and write each resource back with the same
  `replaceAll` / `replaceTombstones` semantics as today's restore.
- Historical restore keeps a confirmation step (it overwrites local data).
- Snapshot writing must not break or roll back a successful sync: if the
  snapshot/index write fails, the primary sync is still reported as succeeded
  (snapshot failure surfaced as a non-fatal warning).
- Timestamp keys carry a short random suffix so concurrent same-second backups
  from multiple devices don't collide.
- (Optional, may be a later step) Retention/GC: keep last N (default 30) plus
  pinned snapshots; opportunistically delete older archives after backup and
  update `index.json`.

## Acceptance Criteria

- [ ] After a successful sync, `snapshots/<timestamp>_<rand>.enc` appears in the
      bucket and `snapshots/index.json` gains a matching entry.
- [ ] The existing `manifest.json` + `resources/*.enc` objects and the current
      `sync()` / `restore()` behavior are unchanged.
- [ ] The history list renders each snapshot's time, device, and per-resource
      item counts without decrypting archives.
- [ ] Deleting `snapshots/index.json` still lets the app list snapshots by
      rebuilding from object listing.
- [ ] "恢复最新" restores via the unchanged latest path; selecting a historical
      snapshot restores from that archive (behind a confirmation dialog).
- [ ] Multi-device flow: edit on A → sync, edit on B → sync; each backup is
      preserved as an immutable snapshot and any config overwritten by a later
      merge/restore can be recovered from an earlier snapshot.
- [ ] A snapshot/index write failure does not mark the primary sync as failed.
- [ ] `source ~/.zshrc && pnpm build` passes.

## Out Of Scope

- No CAS / conditional writes (`If-Match` / `If-None-Match`) and no HEAD/ref
  object model in this task.
- No content-addressed blob dedup or Git-style object store.
- No change to the merge algorithm, the encryption scheme, or the Rust backend.
- No auto-sync / scheduled backup; trigger model stays manual.
- Retention/GC is optional and may be deferred to a follow-up step.
