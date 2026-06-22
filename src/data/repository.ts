import { getStore } from "./storage";
import type { BaseEntity } from "@/types";
import { uid } from "@/lib/utils";

export type CreateInput<T extends BaseEntity> = Omit<
  T,
  "id" | "createdAt" | "updatedAt"
>;
export type UpdateInput<T extends BaseEntity> = Partial<CreateInput<T>>;

/**
 * Generic collection repository persisted as a JSON array under a single key.
 * Swap getStore() for a network/SQLite backend later without changing callers.
 */
export class Repository<T extends BaseEntity> {
  constructor(
    private readonly key: string,
    private readonly idPrefix: string
  ) {}

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
    if (updated) await this.writeAll(next);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const items = (await getStore().get<T[]>(this.key)) ?? [];
    await this.writeAll(items.filter((item) => item.id !== id));
  }
}
