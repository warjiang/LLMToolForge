//! Storage backend abstraction.
//!
//! The sync layer talks to remote object stores exclusively through the
//! [`StorageBackend`] trait so additional backends (GCS, WebDAV, …) can be
//! added later without touching the encryption or orchestration code. This
//! release ships a single S3 (and S3-compatible) implementation in
//! [`super::s3`].

/// Metadata about a stored object. `key` is always *relative* to the
/// configured prefix so the frontend works in logical keys only.
#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ObjectMeta {
    pub key: String,
    pub size: i64,
    pub etag: Option<String>,
    /// Last-modified time as Unix epoch seconds, when the backend reports it.
    pub last_modified: Option<i64>,
}

/// Connection / addressing parameters for a remote object store. Mirrors the
/// TS `StorageConfig` (serde camelCase).
#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StorageConfig {
    /// Backend discriminator, currently always `"s3"`.
    #[serde(default = "default_provider")]
    pub provider: String,
    /// Custom endpoint for S3-compatible stores (MinIO/R2/…). Empty = AWS.
    #[serde(default)]
    pub endpoint: Option<String>,
    pub region: String,
    pub bucket: String,
    /// Optional key prefix all objects live under, e.g. `"llmtoolforge"`.
    #[serde(default)]
    pub prefix: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    /// Force path-style addressing (required by most S3-compatible stores).
    #[serde(default)]
    pub path_style: bool,
}

fn default_provider() -> String {
    "s3".to_string()
}

/// Abstract remote object store. Keys passed in/out are relative to the
/// backend's configured prefix.
#[allow(async_fn_in_trait)]
pub trait StorageBackend {
    /// Verify connectivity and credentials against the configured bucket.
    async fn test(&self) -> Result<(), String>;
    /// Upload (overwrite) an object.
    async fn put(&self, key: &str, body: Vec<u8>) -> Result<ObjectMeta, String>;
    /// Download an object, or `None` if it does not exist.
    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, String>;
    /// List objects under the given relative sub-prefix.
    async fn list(&self, prefix: &str) -> Result<Vec<ObjectMeta>, String>;
    /// Delete an object (no error if it is already absent).
    async fn delete(&self, key: &str) -> Result<(), String>;
}

/// Flatten an error and its `source()` chain into one readable message.
pub fn err_chain<E: std::error::Error>(e: E) -> String {
    let mut msg = e.to_string();
    let mut source = e.source();
    while let Some(inner) = source {
        let inner_msg = inner.to_string();
        if !inner_msg.is_empty() && !msg.contains(&inner_msg) {
            msg.push_str(": ");
            msg.push_str(&inner_msg);
        }
        source = inner.source();
    }
    msg
}

/// Join a base prefix and a relative key with a single `/` separator.
pub fn join_key(prefix: &str, key: &str) -> String {
    let prefix = prefix.trim_matches('/');
    let key = key.trim_start_matches('/');
    if prefix.is_empty() {
        key.to_string()
    } else if key.is_empty() {
        format!("{prefix}/")
    } else {
        format!("{prefix}/{key}")
    }
}
