import { getStore } from "./storage";
import type { BaseEntity } from "@/types";
import { uid } from "@/lib/utils";
import type { Tombstone } from "./sync/types";

export type CreateInput<T extends BaseEntity> = Omit<
  T,
  "id" | "createdAt" | "updatedAt"
>;
export type UpdateInput<T extends BaseEntity> = Partial<CreateInput<T>>;

/** Soft-delete tombstones are persisted under a derived key so the sync layer
 *  can propagate deletions across devices without resurrecting removed items. */
export function tombstoneKey(storeKey: string): string {
  return `${storeKey}__tombstones`;
}

/**
 * Generic collection repository persisted as a JSON array under a single key.
 * Swap getStore() for a network/SQLite backend later without changing callers.
 */
export class Repository<T extends BaseEntity> {
  constructor(
    private readonly key: string,
    private readonly idPrefix: string
  ) {}

  /** Stable storage key — also used as the resource id by the sync layer. */
  get storeKey(): string {
    return this.key;
  }

  async list(): Promise<T[]> {
    const items = (await getStore().get<T[]>(this.key)) ?? [];
    return [...items].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }

  private async writeAll(items: T[]): Promise<void> {
    await getStore().set(this.key, items);
  }

  async create(input: CreateInput<T>): Promise<T> {
    const now = new Date().toISOString();
    const entity = {
      ...(input as object),
      id: uid(this.idPrefix),
      createdAt: now,
      updatedAt: now,
    } as T;
    const items = (await getStore().get<T[]>(this.key)) ?? [];
    await this.writeAll([entity, ...items]);
    await this.clearTombstone(entity.id);
    return entity;
  }

  async update(id: string, patch: UpdateInput<T>): Promise<T | null> {
    const items = (await getStore().get<T[]>(this.key)) ?? [];
    let updated: T | null = null;
    const next = items.map((item) => {
      if (item.id !== id) return item;
      updated = {
        ...item,
        ...(patch as object),
        updatedAt: new Date().toISOString(),
      } as T;
      return updated;
    });
    if (updated) {
      await this.writeAll(next);
      await this.clearTombstone(id);
    }
    return updated;
  }

  async remove(id: string): Promise<void> {
    const items = (await getStore().get<T[]>(this.key)) ?? [];
    await this.writeAll(items.filter((item) => item.id !== id));
    await this.recordTombstone(id);
  }

  // --- Bulk access used by the sync engine ----------------------------------

  /** Read the raw (unsorted) items as persisted. */
  async readAll(): Promise<T[]> {
    return (await getStore().get<T[]>(this.key)) ?? [];
  }

  /** Overwrite the whole collection (used by merge / restore). */
  async replaceAll(items: T[]): Promise<void> {
    await this.writeAll(items);
  }

  async listTombstones(): Promise<Tombstone[]> {
    return (await getStore().get<Tombstone[]>(tombstoneKey(this.key))) ?? [];
  }

  async replaceTombstones(tombstones: Tombstone[]): Promise<void> {
    await getStore().set(tombstoneKey(this.key), tombstones);
  }

  private async recordTombstone(id: string): Promise<void> {
    const existing = await this.listTombstones();
    const next = existing.filter((t) => t.id !== id);
    next.push({ id, deletedAt: new Date().toISOString() });
    await this.replaceTombstones(next);
  }

  private async clearTombstone(id: string): Promise<void> {
    const existing = await this.listTombstones();
    if (existing.some((t) => t.id === id)) {
      await this.replaceTombstones(existing.filter((t) => t.id !== id));
    }
  }
}
