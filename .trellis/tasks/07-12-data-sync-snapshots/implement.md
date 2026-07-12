# Implementation Plan

Each step is independently verifiable; run `source ~/.zshrc && pnpm build` after
each. Backend (Rust) is expected to need no changes.

## Step 1 — Types + snapshot write/list (engine)

1. In `src/data/sync/types.ts`: add `SnapshotArchive`, `SnapshotIndexEntry`,
   `SnapshotIndex`, and constants `SNAPSHOTS_PREFIX`, `SNAPSHOTS_INDEX_KEY`,
   helper `snapshotKey(id)`.
2. In `src/data/sync/engine.ts`: add `writeSnapshot()` and `listSnapshots()`
   (with the `listObjects` fallback). Hook `writeSnapshot` into `runSync` after
   the manifest write, wrapped so failures are non-fatal warnings. Collect the
   per-resource merged payloads inside the existing loop.
3. Verify: a sync produces `snapshots/<ts>_<rand>.enc` and a matching
   `index.json` entry; sync still succeeds if the snapshot write is forced to
   fail.

## Step 2 — Restore from snapshot (engine + store)

1. In `engine.ts`: add `restoreFromSnapshot(config, enc, snapshotId)` reusing the
   `replaceAll` / `replaceTombstones` semantics of `restoreFromRemote`.
2. In `src/store/sync.ts`: add `snapshots` + `snapshotsLoading` state and
   `loadSnapshots()` / `restoreSnapshot(id)` actions; keep `sync()`/`restore()`.
3. Verify: can list snapshots and restore local collections from a chosen one;
   `restoreFromRemote` (default) is untouched.

## Step 3 — Version history UI

1. In `src/pages/settings/StorageSyncCard.tsx`: add the "版本历史" entry,
   render the snapshot list (time / device / per-resource counts), wire
   "恢复最新" to the existing `restore()` and historical entries to
   `restoreSnapshot(id)` behind `ConfirmDialog`.
2. Add i18n keys under the `pages` namespace for the new labels.
3. Verify: default restore-latest unchanged; historical restore works behind
   confirmation; layout/visual rhythm preserved.

## Step 4 — Retention / GC (optional)

1. Add keep-last-N (default 30) + pinned retention; opportunistic GC after
   backup deletes older `snapshots/*.enc` and updates `index.json`.
2. Verify: over-limit archives removed; remaining ones still restorable; index
   consistent.

## Verification

- `source ~/.zshrc && pnpm build` after each step.
- Record manual acceptance in the task's `manual-acceptance.md`:
  - multi-device alternate edits → history visible and rollbackable;
  - restoring from an older snapshot recovers overwritten differential config;
  - deleting `index.json` still lists snapshots via listing fallback;
  - forced snapshot-write failure does not fail the primary sync.
