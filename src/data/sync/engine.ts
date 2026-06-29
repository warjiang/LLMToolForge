import { storageBackend } from "./backend";
import { syncRegistry } from "./registry";
import { mergeResource } from "./tombstones";
import {
  MANIFEST_KEY,
  SCHEMA_VERSION,
  resourceRemoteKey,
  type EncryptionConfig,
  type ResourcePayload,
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
