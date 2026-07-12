import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uid } from "@/lib/utils";
import {
  listSnapshots,
  restoreFromRemote,
  restoreFromSnapshot,
  runSync,
  testConnection,
} from "@/data/sync/engine";
import { storageBackend } from "@/data/sync/backend";
import { reloadSyncedData } from "./index";
import type {
  SnapshotIndexEntry,
  StorageConfig,
  SyncOutcome,
  SyncPhase,
} from "@/data/sync/types";

const DEFAULT_CONFIG: StorageConfig = {
  provider: "s3",
  endpoint: "",
  region: "us-east-1",
  bucket: "",
  prefix: "llmtoolforge",
  accessKeyId: "",
  secretAccessKey: "",
  pathStyle: false,
};

interface SyncStore {
  config: StorageConfig;
  /** Encryption passphrase. Persisted locally (threat model is the remote
   *  bucket, not this device, which already holds plaintext data). */
  passphrase: string;
  /** Base64 KDF salt; shared with other devices via the remote manifest. */
  saltB64: string;
  deviceId: string;
  phase: SyncPhase;
  error: string | null;
  lastSyncedAt: string | null;
  lastOutcome: SyncOutcome | null;
  /** History snapshots listed from the remote (newest-first). */
  snapshots: SnapshotIndexEntry[];
  snapshotsLoading: boolean;

  setConfig: (patch: Partial<StorageConfig>) => void;
  setPassphrase: (passphrase: string) => void;
  isConfigured: () => boolean;
  test: () => Promise<boolean>;
  sync: () => Promise<boolean>;
  restore: () => Promise<boolean>;
  /** Load the remote history snapshot list into `snapshots`. */
  loadSnapshots: () => Promise<boolean>;
  /** Restore local collections from a chosen history snapshot. */
  restoreSnapshot: (snapshotId: string) => Promise<boolean>;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function ensureSalt(current: string): Promise<string> {
  if (current) return current;
  return storageBackend.generateSalt();
}

export const useSyncStore = create<SyncStore>()(
  persist(
    (set, get) => ({
      config: DEFAULT_CONFIG,
      passphrase: "",
      saltB64: "",
      deviceId: uid("device"),
      phase: "idle",
      error: null,
      lastSyncedAt: null,
      lastOutcome: null,
      snapshots: [],
      snapshotsLoading: false,

      setConfig: (patch) =>
        set((s) => ({ config: { ...s.config, ...patch }, phase: "idle", error: null })),

      setPassphrase: (passphrase) => set({ passphrase, phase: "idle", error: null }),

      isConfigured: () => {
        const { config, passphrase } = get();
        return Boolean(
          config.bucket &&
            config.accessKeyId &&
            config.secretAccessKey &&
            passphrase
        );
      },

      test: async () => {
        set({ phase: "testing", error: null });
        try {
          await testConnection(get().config);
          set({ phase: "success" });
          return true;
        } catch (e) {
          set({ phase: "error", error: messageOf(e) });
          return false;
        }
      },

      sync: async () => {
        if (!get().isConfigured()) {
          set({ phase: "error", error: "storage sync is not fully configured" });
          return false;
        }
        set({ phase: "syncing", error: null });
        try {
          const saltB64 = await ensureSalt(get().saltB64);
          const { config, passphrase, deviceId } = get();
          const result = await runSync(
            config,
            { passphrase, saltB64 },
            deviceId
          );
          await reloadSyncedData();
          set({
            phase: "success",
            saltB64: result.saltB64,
            lastSyncedAt: result.outcome.at,
            lastOutcome: result.outcome,
          });
          return true;
        } catch (e) {
          set({ phase: "error", error: messageOf(e) });
          return false;
        }
      },

      restore: async () => {
        if (!get().isConfigured()) {
          set({ phase: "error", error: "storage sync is not fully configured" });
          return false;
        }
        set({ phase: "restoring", error: null });
        try {
          const saltB64 = await ensureSalt(get().saltB64);
          const { config, passphrase } = get();
          const result = await restoreFromRemote(config, { passphrase, saltB64 });
          await reloadSyncedData();
          set({
            phase: "success",
            saltB64: result.saltB64,
            lastSyncedAt: result.outcome.at,
            lastOutcome: result.outcome,
          });
          return true;
        } catch (e) {
          set({ phase: "error", error: messageOf(e) });
          return false;
        }
      },

      loadSnapshots: async () => {
        if (!get().isConfigured()) {
          set({ error: "storage sync is not fully configured" });
          return false;
        }
        set({ snapshotsLoading: true, error: null });
        try {
          const snapshots = await listSnapshots(get().config);
          set({ snapshots, snapshotsLoading: false });
          return true;
        } catch (e) {
          set({ snapshotsLoading: false, error: messageOf(e) });
          return false;
        }
      },

      restoreSnapshot: async (snapshotId) => {
        if (!get().isConfigured()) {
          set({ phase: "error", error: "storage sync is not fully configured" });
          return false;
        }
        set({ phase: "restoring", error: null });
        try {
          const saltB64 = await ensureSalt(get().saltB64);
          const { config, passphrase } = get();
          const result = await restoreFromSnapshot(
            config,
            { passphrase, saltB64 },
            snapshotId
          );
          await reloadSyncedData();
          set({
            phase: "success",
            saltB64: result.saltB64,
            lastSyncedAt: result.outcome.at,
            lastOutcome: result.outcome,
          });
          return true;
        } catch (e) {
          set({ phase: "error", error: messageOf(e) });
          return false;
        }
      },
    }),
    {
      name: "storage-sync-settings",
      partialize: (state) => ({
        config: state.config,
        passphrase: state.passphrase,
        saltB64: state.saltB64,
        deviceId: state.deviceId,
        lastSyncedAt: state.lastSyncedAt,
        lastOutcome: state.lastOutcome,
      }),
    }
  )
);
