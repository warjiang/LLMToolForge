# Versioned Snapshot Backups — Design

## Approach

Side-attach an append-only history area (`snapshots/`) to the existing remote
layout. The current backup/restore main path is untouched; every successful
backup additionally packs all resources into one immutable, timestamped,
encrypted archive and registers it in a plaintext index. Restore defaults to the
existing "latest" path; a new capability restores from any chosen archive.

Rationale for the minimal shape (locked with user): no CAS, whole-archive single
file, existing main path unchanged, restore-latest stays default.

## Remote Layout (pure addition)

```
llmtoolforge/
  manifest.json                       # unchanged
  resources/*.json.enc                # unchanged (latest data, still overwritten)
  snapshots/                          # NEW, append-only
    index.json                        # plaintext metadata list (display without decryption)
    2026-07-12T15-53-01Z_a1b2.enc     # encrypted archive: all resource payloads for one backup
    2026-07-12T18-20-44Z_c3d4.enc
```

- Snapshot object key: `snapshots/<ISO8601-with-":"→"-">_<rand>.enc`. Timestamp
  is lexicographically sortable == chronologically sortable; the short random
  suffix avoids same-second multi-device collisions.
- Existing objects are never touched by the snapshot logic.

## Contracts (frontend-only, `src/data/sync/types.ts`)

```ts
/** Decrypted payload of snapshots/<id>.enc — the full set of resources for one backup. */
interface SnapshotArchive {
  snapshotId: string;      // == key stem, e.g. "2026-07-12T15-53-01Z_a1b2"
  createdAt: string;       // ISO timestamp
  deviceId: string;        // device that produced the backup
  resources: Record<string, ResourcePayload>;  // reuse existing ResourcePayload
}

/** One row in the plaintext index cache. */
interface SnapshotIndexEntry {
  id: string;
  key: string;                          // "snapshots/<id>.enc"
  createdAt: string;
  deviceId: string;
  resourceCounts: Record<string, number>;  // items per resource, for the history panel
}

interface SnapshotIndex {
  schemaVersion: 1;
  snapshots: SnapshotIndexEntry[];      // newest-first
}

// New constants / helpers:
const SNAPSHOTS_PREFIX = "snapshots/";
const SNAPSHOTS_INDEX_KEY = "snapshots/index.json";
function snapshotKey(id: string): string; // `snapshots/${id}.enc`
```

- `SnapshotArchive.resources` reuses the existing `ResourcePayload`
  (`{ items, tombstones }`), so archive contents are shape-identical to what
  `runSync` already merges and to what `restoreFromRemote` already writes back.

## Engine Changes (`src/data/sync/engine.ts`)

Additive functions; `restoreFromRemote` is left byte-for-byte unchanged.

- `runSync`: inside the existing per-resource loop, collect each merged
  `payload` into a `Record<string, ResourcePayload>`. After the manifest is
  written successfully, call `writeSnapshot(config, enc, deviceId, payloads)`.
  Snapshot writing is wrapped so a failure is caught and reported as a non-fatal
  warning — the sync outcome is still success.
- `writeSnapshot(config, enc, deviceId, payloads)`:
  1. Build `SnapshotArchive`, `JSON.stringify`, `pushObject(snapshotKey(id), ...)`
     (encrypted via existing crypto).
  2. Read current `index.json` (tolerate missing/corrupt), prepend the new
     `SnapshotIndexEntry`, `putText(SNAPSHOTS_INDEX_KEY, ...)`.
- `listSnapshots(config)`:
  1. Read `index.json`; if present and parseable, return it.
  2. Fallback: `listObjects(SNAPSHOTS_PREFIX)`, filter `*.enc`, derive
     `id`/`createdAt` from the key, return entries (without `resourceCounts`).
     This guarantees snapshots are always discoverable even if the index is lost.
- `restoreFromSnapshot(config, enc, snapshotId)`:
  1. `pullObject(snapshotKey(snapshotId))`, decrypt, `JSON.parse` to
     `SnapshotArchive`.
  2. For each registered resource, `repo.replaceAll(payload.items)` +
     `repo.replaceTombstones(payload.tombstones ?? [])` — identical semantics to
     `restoreFromRemote`, just sourced from the archive.
  3. Reuse the same salt-resolution rule as restore (`manifest`/archive salt →
     `encryption.saltB64`).

## Store Changes (`src/store/sync.ts`)

- Add state: `snapshots: SnapshotIndexEntry[]`, `snapshotsLoading: boolean`.
- Add actions:
  - `loadSnapshots()`: calls `listSnapshots`, populates state.
  - `restoreSnapshot(id)`: calls `restoreFromSnapshot`, then `reloadSyncedData()`;
    mirrors the existing `restore()` phase/error handling.
- Existing `sync()` / `restore()` are preserved. `sync()` triggers the snapshot
  write via the engine (transparent to the store beyond a possible warning field).

## UI Changes (`src/pages/settings/StorageSyncCard.tsx`)

- Add a "版本历史 / Version history" affordance next to 恢复.
- History list shows each snapshot's `createdAt`, `deviceId`, and per-resource
  item counts (from `resourceCounts`).
- "恢复最新" keeps the existing default (unchanged `restore()` path).
- Selecting a historical entry calls `restoreSnapshot(id)` behind the existing
  `ConfirmDialog` (it overwrites local data).
- Preserve the current grouped 2-column layout and visual rhythm; add i18n keys
  under the `pages` namespace for the new labels.

## Failure & Robustness

- Snapshot write is best-effort and isolated: a failure must not fail or roll
  back the primary sync.
- `index.json` is a cache, not the source of truth; the source of truth is the
  set of `snapshots/*.enc` objects, so a lost/stale index is recoverable via
  `listSnapshots` fallback.
- Concurrent multi-device backups: each writes a distinct
  `<timestamp>_<rand>.enc`, so no archive is lost. `index.json` is
  last-writer-wins and may temporarily miss a concurrent entry; the listing
  fallback reconciles it. (This is the accepted "self-heal via immutable
  snapshots" trade-off; no CAS this task.)

## Retention / GC (optional, deferrable)

- Default: keep last N = 30 snapshots + user-pinned; opportunistic GC after
  backup deletes older `snapshots/*.enc` and updates `index.json`. Independent
  step; safe to omit initially.

## Compatibility

- No `schemaVersion` bump for `manifest.json`; existing clients keep working.
- Older clients simply ignore the `snapshots/` prefix.
- Encryption scheme (`crypto.rs`), merge algorithm (`tombstones.ts`), and the
  Rust backend are all unchanged.
