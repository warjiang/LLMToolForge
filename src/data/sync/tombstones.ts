import type { BaseEntity } from "@/types";
import type { ResourcePayload, Tombstone } from "./types";

export interface MergeResult<T extends BaseEntity> {
  items: T[];
  tombstones: Tombstone[];
  /** True when the merged result differs from the local input. */
  changedLocal: boolean;
}

function latestTombstone(
  tombstones: Tombstone[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of tombstones) {
    const prev = map.get(t.id);
    if (!prev || t.deletedAt > prev) map.set(t.id, t.deletedAt);
  }
  return map;
}

function latestItem<T extends BaseEntity>(items: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    const prev = map.get(item.id);
    if (!prev || item.updatedAt >= prev.updatedAt) map.set(item.id, item);
  }
  return map;
}

/**
 * Merge a local and remote payload of the same resource using per-item
 * last-write-wins on `updatedAt`, with deletions expressed as tombstones.
 *
 * For each id the newest signal wins:
 *  - if the newest tombstone is at least as recent as the newest live item,
 *    the item stays deleted (a tombstone is kept);
 *  - otherwise the newest live item wins (any tombstone is dropped).
 */
export function mergeResource<T extends BaseEntity>(
  local: ResourcePayload<T>,
  remote: ResourcePayload<T>
): MergeResult<T> {
  // Newest live item per id (local wins exact ties because it is applied last).
  const items = latestItem<T>([...remote.items, ...local.items]);

  // Newest deletion per id across both sides.
  const tombstones = latestTombstone([
    ...remote.tombstones,
    ...local.tombstones,
  ]);

  const resultItems: T[] = [];
  const resultTombstones: Tombstone[] = [];
  const ids = new Set<string>([...items.keys(), ...tombstones.keys()]);

  for (const id of ids) {
    const item = items.get(id);
    const deletedAt = tombstones.get(id);
    if (deletedAt && (!item || deletedAt >= item.updatedAt)) {
      resultTombstones.push({ id, deletedAt });
    } else if (item) {
      resultItems.push(item);
    }
  }

  resultItems.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const changedLocal =
    serialize(resultItems) !== serialize(local.items) ||
    serializeTombstones(resultTombstones) !== serializeTombstones(local.tombstones);

  return { items: resultItems, tombstones: resultTombstones, changedLocal };
}

function serialize<T extends BaseEntity>(items: T[]): string {
  return JSON.stringify(
    [...items].sort((a, b) => a.id.localeCompare(b.id))
  );
}

function serializeTombstones(tombstones: Tombstone[]): string {
  return JSON.stringify(
    [...tombstones].sort((a, b) => a.id.localeCompare(b.id))
  );
}
