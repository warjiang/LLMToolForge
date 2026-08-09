import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteSnapshot } from "@/data/sync/engine";
import {
  SNAPSHOTS_INDEX_KEY,
  snapshotKey,
  type SnapshotIndex,
  type SnapshotIndexEntry,
  type StorageConfig,
} from "@/data/sync/types";

const deleteObject = vi.hoisted(() => vi.fn());
const getText = vi.hoisted(() => vi.fn());
const putText = vi.hoisted(() => vi.fn());

vi.mock("@/data/sync/backend", () => ({
  storageBackend: {
    deleteObject,
    getText,
    putText,
  },
}));

const config: StorageConfig = {
  provider: "s3",
  endpoint: "",
  region: "us-east-1",
  bucket: "b",
  prefix: "llmtoolforge",
  accessKeyId: "ak",
  secretAccessKey: "sk",
  pathStyle: false,
};

function entry(id: string): SnapshotIndexEntry {
  return {
    id,
    key: snapshotKey(id),
    createdAt: `2026-08-0${id.slice(-1)}T00:00:00Z`,
    deviceId: "device_a",
    resourceCounts: { apiKeys: 1 },
  };
}

function indexJson(...ids: string[]): string {
  const index: SnapshotIndex = {
    schemaVersion: 1,
    snapshots: ids.map(entry),
  };
  return JSON.stringify(index);
}

beforeEach(() => {
  deleteObject.mockReset().mockResolvedValue(undefined);
  getText.mockReset();
  putText.mockReset().mockResolvedValue({ key: "", size: 0 });
});

describe("deleteSnapshot", () => {
  it("deletes the archive object and rewrites the index without that entry", async () => {
    getText.mockResolvedValue(indexJson("snap1", "snap2", "snap3"));

    await deleteSnapshot(config, "snap2");

    expect(deleteObject).toHaveBeenCalledWith(config, snapshotKey("snap2"));
    expect(putText).toHaveBeenCalledTimes(1);

    const [, key, contents] = putText.mock.calls[0];
    expect(key).toBe(SNAPSHOTS_INDEX_KEY);
    const written = JSON.parse(contents as string) as SnapshotIndex;
    expect(written.snapshots.map((s) => s.id)).toEqual(["snap1", "snap3"]);
    expect(written.schemaVersion).toBe(1);
  });

  it("still deletes the object but skips rewrite when the index is missing", async () => {
    getText.mockResolvedValue(null);

    await deleteSnapshot(config, "snap1");

    expect(deleteObject).toHaveBeenCalledWith(config, snapshotKey("snap1"));
    expect(putText).not.toHaveBeenCalled();
  });

  it("does not rewrite the index when the id is absent from it", async () => {
    getText.mockResolvedValue(indexJson("snap1", "snap2"));

    await deleteSnapshot(config, "snap9");

    expect(deleteObject).toHaveBeenCalledWith(config, snapshotKey("snap9"));
    expect(putText).not.toHaveBeenCalled();
  });
});
