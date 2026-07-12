import { storageBackend } from "./backend";
import { syncRegistry } from "./registry";
import { mergeResource } from "./tombstones";
import {
  MANIFEST_KEY,
  SCHEMA_VERSION,
  SNAPSHOTS_PREFIX,
  SNAPSHOTS_INDEX_KEY,
  SNAPSHOT_SCHEMA_VERSION,
  resourceRemoteKey,
  snapshotKey,
  type EncryptionConfig,
  type ResourcePayload,
  type SnapshotArchive,
  type SnapshotIndex,
  type SnapshotIndexEntry,
  type StorageConfig,
  type SyncManifest,
  type SyncOutcome,
} from "./types";
import type { BaseEntity } from "@/types";

export interface EngineSyncResult {
  outcome: SyncOutcome;
  /** Authoritative salt actually used (may come from the remote manifest). */
  saltB64: string;
}

function contentHash(input: string): string {
  // djb2 — cheap change-detection hash, not for security.
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

async function readManifest(config: StorageConfig): Promise<SyncManifest | null> {
  const text = await storageBackend.getText(config, MANIFEST_KEY);
  if (!text) return null;
  try {
    return JSON.parse(text) as SyncManifest;
  } catch {
    throw new Error("remote manifest is corrupted");
  }
}

async function readLocal<T extends BaseEntity>(
  resource: (typeof syncRegistry)[number]
): Promise<ResourcePayload<T>> {
  const repo = resource.repo;
  return {
    items: (await repo.readAll()) as T[],
    tombstones: await repo.listTombstones(),
  };
}

/** Validate the passphrase against the remote manifest's salt (network call). */
export async function testConnection(config: StorageConfig): Promise<void> {
  await storageBackend.testConnection(config);
}

/**
 * Two-way sync: pull each resource, merge by `updatedAt` + tombstones, write the
 * merged result back locally, and push it to the remote. The KDF salt is taken
 * from the remote manifest when one exists so multiple devices share a key.
 */
export async function runSync(
  config: StorageConfig,
  encryption: EncryptionConfig,
  deviceId: string
): Promise<EngineSyncResult> {
  const remoteManifest = await readManifest(config);
  const saltB64 = remoteManifest?.saltB64 || encryption.saltB64;
  if (!saltB64) throw new Error("missing encryption salt");
  const enc: EncryptionConfig = { passphrase: encryption.passphrase, saltB64 };

  const resources: SyncManifest["resources"] = {};
  const snapshotPayloads: Record<string, ResourcePayload> = {};
  let pushed = 0;
  let mergedItems = 0;

  for (const resource of syncRegistry) {
    const local = await readLocal(resource);

    const remoteKey = resourceRemoteKey(resource.id);
    const remoteText = await storageBackend.pullObject(config, enc, remoteKey);
    const remote: ResourcePayload = remoteText
      ? (JSON.parse(remoteText) as ResourcePayload)
      : { items: [], tombstones: [] };

    const merged = mergeResource(local, remote);

    if (merged.changedLocal) {
      await resource.repo.replaceAll(merged.items);
      await resource.repo.replaceTombstones(merged.tombstones);
    }
    mergedItems += merged.items.length;

    const payload: ResourcePayload = {
      items: merged.items,
      tombstones: merged.tombstones,
    };
    const plaintext = JSON.stringify(payload);
    await storageBackend.pushObject(config, enc, remoteKey, plaintext);
    pushed += 1;

    snapshotPayloads[resource.id] = payload;
    resources[resource.id] = {
      remoteKey,
      hash: contentHash(plaintext),
      updatedAt: new Date().toISOString(),
    };
  }

  const manifest: SyncManifest = {
    schemaVersion: SCHEMA_VERSION,
    deviceId: remoteManifest?.deviceId || deviceId,
    saltB64,
    updatedAt: new Date().toISOString(),
    resources,
  };
  await storageBackend.putText(config, MANIFEST_KEY, JSON.stringify(manifest));

  // Best-effort history snapshot. A failure here must NOT fail the sync: the
  // primary backup (manifest + resources/*.enc) already succeeded above.
  try {
    await writeSnapshot(config, enc, deviceId, snapshotPayloads);
  } catch (e) {
    console.warn("sync: history snapshot write failed (non-fatal)", e);
  }

  return {
    outcome: { pushed, mergedItems, at: manifest.updatedAt },
    saltB64,
  };
}

/**
 * Restore: overwrite local collections with the remote snapshot. Resources that
 * are absent from the remote are left untouched (never wiped).
 */
export async function restoreFromRemote(
  config: StorageConfig,
  encryption: EncryptionConfig
): Promise<EngineSyncResult> {
  const manifest = await readManifest(config);
  if (!manifest) throw new Error("no remote backup found");
  const saltB64 = manifest.saltB64 || encryption.saltB64;
  const enc: EncryptionConfig = { passphrase: encryption.passphrase, saltB64 };

  let restored = 0;
  for (const resource of syncRegistry) {
    const remoteKey = resourceRemoteKey(resource.id);
    const remoteText = await storageBackend.pullObject(config, enc, remoteKey);
    if (!remoteText) continue;
    const payload = JSON.parse(remoteText) as ResourcePayload;
    await resource.repo.replaceAll(payload.items);
    await resource.repo.replaceTombstones(payload.tombstones ?? []);
    restored += payload.items.length;
  }

  return {
    outcome: { pushed: 0, mergedItems: restored, at: new Date().toISOString() },
    saltB64,
  };
}

/** Build a lexicographically-sortable snapshot id: an ISO timestamp with the
 *  time separators made filename-safe, plus a short random suffix to avoid
 *  same-second collisions across devices. e.g. "2026-07-12T15-53-01Z_a1b2". */
function newSnapshotId(createdAt: string): string {
  const stamp = createdAt.replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
  const rand = Math.random().toString(36).slice(2, 6);
  return `${stamp}_${rand}`;
}

/** Best-effort recovery of the ISO timestamp from a snapshot id (for the
 *  listing fallback, which never decrypts the archive). */
function createdAtFromId(id: string): string {
  const stamp = id.split("_")[0] ?? id;
  const t = stamp.indexOf("T");
  if (t < 0) return stamp;
  const date = stamp.slice(0, t);
  const time = stamp.slice(t + 1).replace(/-/g, ":");
  return `${date}T${time}`;
}

async function readSnapshotIndex(
  config: StorageConfig
): Promise<SnapshotIndex | null> {
  const text = await storageBackend.getText(config, SNAPSHOTS_INDEX_KEY);
  if (!text) return null;
  try {
    return JSON.parse(text) as SnapshotIndex;
  } catch {
    return null;
  }
}

/**
 * Write one immutable, whole-archive history snapshot of the merged payloads and
 * register it in the plaintext index. Called after a successful sync; callers
 * treat failures as non-fatal.
 */
export async function writeSnapshot(
  config: StorageConfig,
  encryption: EncryptionConfig,
  deviceId: string,
  payloads: Record<string, ResourcePayload>
): Promise<SnapshotIndexEntry> {
  const createdAt = new Date().toISOString();
  const id = newSnapshotId(createdAt);
  const key = snapshotKey(id);

  const archive: SnapshotArchive = {
    snapshotId: id,
    createdAt,
    deviceId,
    resources: payloads,
  };
  await storageBackend.pushObject(config, encryption, key, JSON.stringify(archive));

  const resourceCounts: Record<string, number> = {};
  for (const [resId, payload] of Object.entries(payloads)) {
    resourceCounts[resId] = payload.items.length;
  }
  const entry: SnapshotIndexEntry = {
    id,
    key,
    createdAt,
    deviceId,
    resourceCounts,
  };

  // The index is a cache; a lost/racy index is reconciled by listSnapshots'
  // listing fallback, so we simply prepend and overwrite last-writer-wins.
  const existing = await readSnapshotIndex(config);
  const snapshots = [entry, ...(existing?.snapshots ?? [])];
  const index: SnapshotIndex = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    snapshots,
  };
  await storageBackend.putText(config, SNAPSHOTS_INDEX_KEY, JSON.stringify(index));

  return entry;
}

/**
 * List history snapshots newest-first. Prefers the plaintext index cache; if it
 * is missing or unreadable, rebuilds the list by enumerating `snapshots/*.enc`
 * objects (without `resourceCounts`, which live only inside the archives).
 */
export async function listSnapshots(
  config: StorageConfig
): Promise<SnapshotIndexEntry[]> {
  const index = await readSnapshotIndex(config);
  if (index?.snapshots?.length) {
    return [...index.snapshots].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }

  const objects = await storageBackend.listObjects(config, SNAPSHOTS_PREFIX);
  const entries: SnapshotIndexEntry[] = [];
  for (const obj of objects) {
    if (!obj.key.endsWith(".enc")) continue;
    const id = obj.key.slice(SNAPSHOTS_PREFIX.length, -".enc".length);
    if (!id) continue;
    entries.push({
      id,
      key: obj.key,
      createdAt: createdAtFromId(id),
      deviceId: "",
      resourceCounts: {},
    });
  }
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Restore local collections from a chosen history snapshot. Same overwrite
 * semantics as `restoreFromRemote` (`replaceAll` / `replaceTombstones`), but the
 * source is the immutable archive `snapshots/<id>.enc` rather than the latest
 * `resources/*.enc`. Resources absent from the archive are left untouched.
 */
export async function restoreFromSnapshot(
  config: StorageConfig,
  encryption: EncryptionConfig,
  snapshotId: string
): Promise<EngineSyncResult> {
  // The KDF salt lives in the manifest; fall back to the locally-held salt.
  const manifest = await readManifest(config);
  const saltB64 = manifest?.saltB64 || encryption.saltB64;
  if (!saltB64) throw new Error("missing encryption salt");
  const enc: EncryptionConfig = { passphrase: encryption.passphrase, saltB64 };

  const text = await storageBackend.pullObject(config, enc, snapshotKey(snapshotId));
  if (!text) throw new Error("snapshot not found");
  const archive = JSON.parse(text) as SnapshotArchive;

  let restored = 0;
  for (const resource of syncRegistry) {
    const payload = archive.resources?.[resource.id];
    if (!payload) continue;
    await resource.repo.replaceAll(payload.items);
    await resource.repo.replaceTombstones(payload.tombstones ?? []);
    restored += payload.items.length;
  }

  return {
    outcome: { pushed: 0, mergedItems: restored, at: new Date().toISOString() },
    saltB64,
  };
}
