import type { BaseEntity } from "@/types";
import type { Repository } from "../repository";

/** S3 / S3-compatible connection config. Mirrors the Rust `StorageConfig`. */
export interface StorageConfig {
  provider: "s3";
  /** Custom endpoint for S3-compatible stores (MinIO/R2/…). Empty = AWS. */
  endpoint?: string;
  region: string;
  bucket: string;
  /** Optional key prefix all objects live under. */
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Force path-style addressing (most S3-compatible stores need this). */
  pathStyle: boolean;
}

/** Passphrase-derived encryption config. The passphrase never leaves the
 *  device unencrypted; only the (non-secret) salt is shared via the manifest. */
export interface EncryptionConfig {
  passphrase: string;
  saltB64: string;
}

/** A soft-delete marker so deletions propagate across devices. */
export interface Tombstone {
  id: string;
  deletedAt: string;
}

/** One synced collection. Adding a new syncable resource = one entry here. */
export interface SyncableResource<T extends BaseEntity = BaseEntity> {
  /** Stable logical id; must equal `repo.storeKey`. Used in the remote key. */
  id: string;
  /** i18n label key (under the `pages` namespace) for the UI. */
  labelKey: string;
  repo: Repository<T>;
}

/** The encrypted per-resource payload uploaded to the store. */
export interface ResourcePayload<T extends BaseEntity = BaseEntity> {
  items: T[];
  tombstones: Tombstone[];
}

export interface ResourceManifestEntry {
  remoteKey: string;
  hash: string;
  updatedAt: string;
}

/** Plaintext manifest object; holds the KDF salt so a fresh device can derive
 *  the key after the user enters the passphrase. */
export interface SyncManifest {
  schemaVersion: number;
  deviceId: string;
  saltB64: string;
  updatedAt: string;
  resources: Record<string, ResourceManifestEntry>;
}

export interface ObjectMeta {
  key: string;
  size: number;
  etag?: string | null;
  lastModified?: number | null;
}

export type SyncPhase =
  | "idle"
  | "testing"
  | "syncing"
  | "restoring"
  | "success"
  | "error";

export interface SyncOutcome {
  /** Number of resources pushed to the remote. */
  pushed: number;
  /** Number of items written back locally after merge. */
  mergedItems: number;
  at: string;
}

export const MANIFEST_KEY = "manifest.json";
export const SCHEMA_VERSION = 1;

export function resourceRemoteKey(id: string): string {
  return `resources/${id}.json.enc`;
}
