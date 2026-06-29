//! Storage sync backend: encrypted, multi-resource sync to S3-compatible object
//! stores.
//!
//! This module exposes Tauri commands that the frontend sync engine drives. It
//! is intentionally business-logic-free: it provides secure transport (S3) plus
//! client-side encryption primitives, while merge/registry logic lives in the
//! frontend (`src/data/sync`).

mod backend;
pub mod crypto;
mod s3;

use backend::{ObjectMeta, StorageBackend, StorageConfig};
use crypto::EncryptionConfig;
use s3::S3Backend;

/// Build the configured backend. Only S3 is supported in this release.
fn backend_for(config: &StorageConfig) -> Result<S3Backend, String> {
    match config.provider.as_str() {
        "s3" | "" => S3Backend::new(config),
        other => Err(format!("unsupported storage provider: {other}")),
    }
}

/// Verify connectivity and credentials against the configured bucket/prefix.
#[tauri::command]
pub async fn storage_test_connection(config: StorageConfig) -> Result<(), String> {
    backend_for(&config)?.test().await
}

/// Upload a plaintext object verbatim (used for the sync manifest, which must
/// stay readable to bootstrap the KDF salt on a new device).
#[tauri::command]
pub async fn storage_put_text(
    config: StorageConfig,
    key: String,
    contents: String,
) -> Result<ObjectMeta, String> {
    backend_for(&config)?.put(&key, contents.into_bytes()).await
}

/// Download a plaintext object, or `None` if it does not exist.
#[tauri::command]
pub async fn storage_get_text(
    config: StorageConfig,
    key: String,
) -> Result<Option<String>, String> {
    match backend_for(&config)?.get(&key).await? {
        Some(bytes) => {
            let text = String::from_utf8(bytes).map_err(|e| format!("invalid utf-8: {e}"))?;
            Ok(Some(text))
        }
        None => Ok(None),
    }
}

/// Encrypt `plaintext` and upload it as an opaque object.
#[tauri::command]
pub async fn storage_push_object(
    config: StorageConfig,
    encryption: EncryptionConfig,
    key: String,
    plaintext: String,
) -> Result<ObjectMeta, String> {
    let blob = crypto::encrypt(&encryption, plaintext.as_bytes())?;
    backend_for(&config)?.put(&key, blob).await
}

/// Download and decrypt an object, or `None` if it does not exist.
#[tauri::command]
pub async fn storage_pull_object(
    config: StorageConfig,
    encryption: EncryptionConfig,
    key: String,
) -> Result<Option<String>, String> {
    match backend_for(&config)?.get(&key).await? {
        Some(blob) => {
            let plaintext = crypto::decrypt(&encryption, &blob)?;
            let text = String::from_utf8(plaintext).map_err(|e| format!("invalid utf-8: {e}"))?;
            Ok(Some(text))
        }
        None => Ok(None),
    }
}

/// List objects under the given relative sub-prefix (e.g. `"resources/"`).
#[tauri::command]
pub async fn storage_list_objects(
    config: StorageConfig,
    prefix: String,
) -> Result<Vec<ObjectMeta>, String> {
    backend_for(&config)?.list(&prefix).await
}

/// Delete an object by relative key.
#[tauri::command]
pub async fn storage_delete_object(config: StorageConfig, key: String) -> Result<(), String> {
    backend_for(&config)?.delete(&key).await
}

/// Generate a fresh base64 KDF salt for first-time encryption setup.
#[tauri::command]
pub fn storage_generate_salt() -> String {
    crypto::generate_salt_b64()
}
