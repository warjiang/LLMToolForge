import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promptTemplateRepo } from "@/data/repositories";
import { storageBackend } from "@/data/sync/backend";
import {
  restoreFromSnapshot,
  runSync,
} from "@/data/sync/engine";
import { syncRegistry } from "@/data/sync/registry";
import { mergeResource } from "@/data/sync/tombstones";
import {
  useAgentDefStore,
  useApiKeyStore,
  useGatewayStore,
  useMcpStore,
  usePromptStore,
  useSkillProjectConfigStore,
  useSkillStore,
  useSshHostStore,
  useVolcCredentialStore,
} from "@/store";
import { useSyncStore } from "@/store/sync";
import {
  MANIFEST_KEY,
  SNAPSHOTS_PREFIX,
  resourceRemoteKey,
  snapshotKey,
  type EncryptionConfig,
  type ObjectMeta,
  type ResourcePayload,
  type SnapshotArchive,
  type StorageConfig,
  type Tombstone,
} from "@/data/sync/types";
import type { PromptTemplate } from "@/types";

const config: StorageConfig = {
  provider: "s3",
  endpoint: "",
  region: "us-east-1",
  bucket: "bucket",
  prefix: "llmtoolforge",
  accessKeyId: "access-key",
  secretAccessKey: "secret-key",
  pathStyle: false,
};

const encryption: EncryptionConfig = {
  passphrase: "passphrase",
  saltB64: "salt",
};

const initialSyncState = useSyncStore.getInitialState();
const initialPromptStoreState = usePromptStore.getInitialState();
const syncedCollectionStores = [
  useApiKeyStore,
  useSkillStore,
  useSkillProjectConfigStore,
  useMcpStore,
  useVolcCredentialStore,
  useGatewayStore,
  useAgentDefStore,
  useSshHostStore,
  usePromptStore,
];

const emptyPayload: ResourcePayload<PromptTemplate> = {
  items: [],
  tombstones: [],
};

function prompt(
  id: string,
  updatedAt: string,
  name = `Prompt ${id}`
): PromptTemplate {
  return {
    id,
    name,
    description: `Description ${id}`,
    content: `Content ${id}`,
    tags: ["test"],
    sourceUrl: `https://example.com/${id}`,
    favorite: false,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt,
  };
}

function objectMeta(key: string): ObjectMeta {
  return { key, size: 1, etag: null, lastModified: null };
}

function stubRepositories(promptPayload: ResourcePayload<PromptTemplate>) {
  for (const resource of syncRegistry) {
    const payload =
      resource.id === promptTemplateRepo.storeKey
        ? promptPayload
        : emptyPayload;
    vi.spyOn(resource.repo, "readAll").mockResolvedValue([...payload.items]);
    vi.spyOn(resource.repo, "listTombstones").mockResolvedValue([
      ...payload.tombstones,
    ]);
    vi.spyOn(resource.repo, "replaceAll").mockResolvedValue(undefined);
    vi.spyOn(resource.repo, "replaceTombstones").mockResolvedValue(undefined);
  }
}

describe("PromptTemplate sync merge", () => {
  it("combines different PromptTemplate ids", () => {
    const local = prompt("local", "2026-08-18T01:00:00.000Z");
    const remote = prompt("remote", "2026-08-18T02:00:00.000Z");

    const merged = mergeResource(
      { items: [local], tombstones: [] },
      { items: [remote], tombstones: [] }
    );

    expect(merged.items).toHaveLength(2);
    expect(new Map(merged.items.map((item) => [item.id, item]))).toEqual(
      new Map([
        [local.id, local],
        [remote.id, remote],
      ])
    );
  });

  it.each([
    {
      name: "remote",
      localUpdatedAt: "2026-08-18T01:00:00.000Z",
      remoteUpdatedAt: "2026-08-18T02:00:00.000Z",
    },
    {
      name: "local",
      localUpdatedAt: "2026-08-18T03:00:00.000Z",
      remoteUpdatedAt: "2026-08-18T02:00:00.000Z",
    },
  ])("uses the $name same-id PromptTemplate with the latest updatedAt", ({
    name,
    localUpdatedAt,
    remoteUpdatedAt,
  }) => {
    const local = prompt("shared", localUpdatedAt, "Local edit");
    const remote = prompt("shared", remoteUpdatedAt, "Remote edit");

    const merged = mergeResource(
      { items: [local], tombstones: [] },
      { items: [remote], tombstones: [] }
    );

    expect(merged.items).toEqual([name === "local" ? local : remote]);
  });

  it.each([
    {
      name: "newer tombstone",
      itemUpdatedAt: "2026-08-18T01:00:00.000Z",
      deletedAt: "2026-08-18T02:00:00.000Z",
      expectedLive: false,
    },
    {
      name: "newer record",
      itemUpdatedAt: "2026-08-18T03:00:00.000Z",
      deletedAt: "2026-08-18T02:00:00.000Z",
      expectedLive: true,
    },
  ])("gives precedence to the $name for a PromptTemplate", ({
    itemUpdatedAt,
    deletedAt,
    expectedLive,
  }) => {
    const item = prompt("shared", itemUpdatedAt);
    const tombstone: Tombstone = { id: item.id, deletedAt };

    const merged = mergeResource(
      { items: [item], tombstones: [] },
      { items: [], tombstones: [tombstone] }
    );

    expect(merged.items).toEqual(expectedLive ? [item] : []);
    expect(merged.tombstones).toEqual(expectedLive ? [] : [tombstone]);
  });
});

describe("PromptTemplate snapshot sync", () => {
  const syncedPrompt = prompt("snapshot", "2026-08-18T04:00:00.000Z");
  const syncedTombstone: Tombstone = {
    id: "deleted-prompt",
    deletedAt: "2026-08-18T05:00:00.000Z",
  };
  const promptPayload: ResourcePayload<PromptTemplate> = {
    items: [syncedPrompt],
    tombstones: [syncedTombstone],
  };

  beforeEach(() => {
    stubRepositories(promptPayload);
    vi.spyOn(storageBackend, "getText").mockResolvedValue(null);
    vi.spyOn(storageBackend, "pullObject").mockResolvedValue(null);
    vi.spyOn(storageBackend, "pushObject").mockImplementation(
      async (_config, _encryption, key) => objectMeta(key)
    );
    vi.spyOn(storageBackend, "putText").mockImplementation(
      async (_config, key) => objectMeta(key)
    );
  });

  afterEach(() => {
    useSyncStore.setState(initialSyncState, true);
    usePromptStore.setState(initialPromptStoreState, true);
    vi.restoreAllMocks();
  });

  it("includes the PromptTemplate payload in a successfully written snapshot", async () => {
    await runSync(config, encryption, "device-a");

    const pushObject = vi.mocked(storageBackend.pushObject);
    const snapshotCall = pushObject.mock.calls.find(([, , key]) =>
      key.startsWith(SNAPSHOTS_PREFIX)
    );
    expect(snapshotCall).toBeDefined();

    const archive = JSON.parse(snapshotCall?.[3] ?? "") as SnapshotArchive;
    expect(archive.resources[promptTemplateRepo.storeKey]).toEqual(
      promptPayload
    );
  });

  it("keeps PromptTemplate content and source URLs out of the plaintext manifest", async () => {
    await runSync(config, encryption, "device-a");

    const manifestCall = vi
      .mocked(storageBackend.putText)
      .mock.calls.find(([, key]) => key === MANIFEST_KEY);
    const manifestText = manifestCall?.[2] ?? "";

    expect(manifestText).toContain(promptTemplateRepo.storeKey);
    expect(manifestText).not.toContain(syncedPrompt.content);
    expect(manifestText).not.toContain(syncedPrompt.sourceUrl as string);
  });

  it("keeps a successful primary sync non-fatal when snapshot writing fails", async () => {
    vi.mocked(storageBackend.pushObject).mockImplementation(
      async (_config, _encryption, key) => {
        if (key.startsWith(SNAPSHOTS_PREFIX)) {
          throw new Error("snapshot unavailable");
        }
        return objectMeta(key);
      }
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await runSync(config, encryption, "device-a");

    expect(result.outcome.pushed).toBe(syncRegistry.length);
    expect(storageBackend.pushObject).toHaveBeenCalledWith(
      config,
      encryption,
      resourceRemoteKey(promptTemplateRepo.storeKey),
      JSON.stringify(promptPayload)
    );
    expect(storageBackend.putText).toHaveBeenCalledWith(
      config,
      MANIFEST_KEY,
      expect.any(String)
    );
    expect(warn).toHaveBeenCalledWith(
      "sync: history snapshot write failed (non-fatal)",
      expect.objectContaining({ message: "snapshot unavailable" })
    );
  });

  it("restores PromptTemplate records and tombstones from a snapshot", async () => {
    const archive: SnapshotArchive = {
      snapshotId: "snapshot-a",
      createdAt: "2026-08-18T06:00:00.000Z",
      deviceId: "device-a",
      resources: {
        [promptTemplateRepo.storeKey]: promptPayload,
      },
    };
    vi.mocked(storageBackend.pullObject).mockImplementation(
      async (_config, _encryption, key) =>
        key === snapshotKey(archive.snapshotId)
          ? JSON.stringify(archive)
          : null
    );

    await restoreFromSnapshot(
      config,
      encryption,
      archive.snapshotId
    );

    expect(promptTemplateRepo.replaceAll).toHaveBeenCalledWith(
      promptPayload.items
    );
    expect(promptTemplateRepo.replaceTombstones).toHaveBeenCalledWith(
      promptPayload.tombstones
    );
  });

  it("reloads the visible Prompt collection after a snapshot restore", async () => {
    const archive: SnapshotArchive = {
      snapshotId: "snapshot-reload",
      createdAt: "2026-08-18T06:00:00.000Z",
      deviceId: "device-a",
      resources: {
        [promptTemplateRepo.storeKey]: promptPayload,
      },
    };
    vi.mocked(storageBackend.pullObject).mockImplementation(
      async (_config, _encryption, key) =>
        key === snapshotKey(archive.snapshotId)
          ? JSON.stringify(archive)
          : null
    );
    const loads = syncedCollectionStores.map((store) =>
      vi.spyOn(store.getState(), "load").mockResolvedValue(undefined)
    );
    useSyncStore.setState({
      config,
      passphrase: encryption.passphrase,
      saltB64: encryption.saltB64,
      phase: "idle",
      error: null,
    });

    const restored = await useSyncStore
      .getState()
      .restoreSnapshot(archive.snapshotId);

    expect(restored).toBe(true);
    expect(loads[loads.length - 1]).toHaveBeenCalledOnce();
  });
});
