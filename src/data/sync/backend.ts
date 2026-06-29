import { isTauri } from "@/lib/utils";
import type { EncryptionConfig, ObjectMeta, StorageConfig } from "./types";

/** Thrown when a sync operation is attempted outside the Tauri desktop runtime. */
export class DesktopOnlyError extends Error {
  constructor() {
    super("Storage sync is only available in the desktop app.");
    this.name = "DesktopOnlyError";
  }
}

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new DesktopOnlyError();
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

/**
 * Thin bridge to the Rust storage commands. The Rust side owns S3 transport and
 * AES-256-GCM encryption; this layer only marshals arguments.
 */
export const storageBackend = {
  testConnection(config: StorageConfig): Promise<void> {
    return invoke("storage_test_connection", { config });
  },
  putText(config: StorageConfig, key: string, contents: string): Promise<ObjectMeta> {
    return invoke("storage_put_text", { config, key, contents });
  },
  getText(config: StorageConfig, key: string): Promise<string | null> {
    return invoke("storage_get_text", { config, key });
  },
  pushObject(
    config: StorageConfig,
    encryption: EncryptionConfig,
    key: string,
    plaintext: string
  ): Promise<ObjectMeta> {
    return invoke("storage_push_object", { config, encryption, key, plaintext });
  },
  pullObject(
    config: StorageConfig,
    encryption: EncryptionConfig,
    key: string
  ): Promise<string | null> {
    return invoke("storage_pull_object", { config, encryption, key });
  },
  listObjects(config: StorageConfig, prefix: string): Promise<ObjectMeta[]> {
    return invoke("storage_list_objects", { config, prefix });
  },
  deleteObject(config: StorageConfig, key: string): Promise<void> {
    return invoke("storage_delete_object", { config, key });
  },
  generateSalt(): Promise<string> {
    return invoke("storage_generate_salt", {});
  },
};
