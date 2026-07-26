import { getStore, type KeyValueStore } from "@/data/storage";
import type {
  CombinationSource,
  CreativityHistoryRecord,
  CreativitySettings,
} from "./types";

const HISTORY_KEY = "creativityHistory";
const SETTINGS_KEY = "creativitySettings";
const HISTORY_LIMIT = 50;

export interface CreativityHistoryStore {
  list(): Promise<CreativityHistoryRecord[]>;
  upsert(record: CreativityHistoryRecord): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  loadSettings(): Promise<CreativitySettings | null>;
  saveSettings(settings: CreativitySettings): Promise<void>;
}

function newestFirst(
  records: CreativityHistoryRecord[],
): CreativityHistoryRecord[] {
  return [...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

type StoredCreativityHistoryRecord = Omit<
  CreativityHistoryRecord,
  "source"
> & {
  source?: CombinationSource;
};

export function createCreativityHistory(
  store: KeyValueStore,
): CreativityHistoryStore {
  const read = async () => {
    const stored =
      (await store.get<StoredCreativityHistoryRecord[]>(HISTORY_KEY)) ?? [];
    return newestFirst(
      stored.map((record) => ({
        ...record,
        source: record.source ?? "ai",
      })),
    );
  };

  return {
    list: read,
    upsert: async (record) => {
      const existing = await read();
      const next = [record, ...existing.filter((item) => item.id !== record.id)];
      await store.set(HISTORY_KEY, newestFirst(next).slice(0, HISTORY_LIMIT));
    },
    remove: async (id) => {
      const existing = await read();
      await store.set(
        HISTORY_KEY,
        existing.filter((item) => item.id !== id),
      );
    },
    clear: () => store.set(HISTORY_KEY, []),
    loadSettings: () => store.get<CreativitySettings>(SETTINGS_KEY),
    saveSettings: (settings) => store.set(SETTINGS_KEY, settings),
  };
}

export const creativityHistory = createCreativityHistory(getStore());
