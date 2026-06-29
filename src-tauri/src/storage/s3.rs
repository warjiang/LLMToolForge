//! S3 (and S3-compatible) [`StorageBackend`] implementation.
//!
//! Uses static access-key credentials and a rustls-ring TLS stack (we avoid
//! `aws-config` and the default `aws-lc-rs` provider so no C toolchain / NASM is
//! required to build on CI).

use aws_sdk_s3::config::{BehaviorVersion, Credentials, Region};
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::Client;
use aws_smithy_http_client::tls::{rustls_provider::CryptoMode, Provider};

use super::backend::{err_chain, join_key, ObjectMeta, StorageBackend, StorageConfig};

pub struct S3Backend {
    client: Client,
    bucket: String,
    prefix: String,
}

impl S3Backend {
    pub fn new(cfg: &StorageConfig) -> Result<Self, String> {
        if cfg.bucket.trim().is_empty() {
            return Err("bucket is required".into());
        }
        if cfg.access_key_id.trim().is_empty() || cfg.secret_access_key.trim().is_empty() {
            return Err("access key id and secret access key are required".into());
        }

        let credentials = Credentials::new(
            cfg.access_key_id.clone(),
            cfg.secret_access_key.clone(),
            None,
            None,
            "llmtoolforge",
        );

        let http_client = aws_smithy_http_client::Builder::new()
            .tls_provider(Provider::Rustls(CryptoMode::Ring))
            .build_https();

        let region = if cfg.region.trim().is_empty() {
            "us-east-1".to_string()
        } else {
            cfg.region.clone()
        };

        let mut builder = aws_sdk_s3::Config::builder()
            .behavior_version(BehaviorVersion::latest())
            .region(Region::new(region))
            .credentials_provider(credentials)
            .http_client(http_client)
            .force_path_style(cfg.path_style);

        if let Some(endpoint) = &cfg.endpoint {
            let endpoint = endpoint.trim();
            if !endpoint.is_empty() {
                builder = builder.endpoint_url(endpoint);
            }
        }

        Ok(Self {
            client: Client::from_conf(builder.build()),
            bucket: cfg.bucket.clone(),
            prefix: cfg.prefix.clone(),
        })
    }

    fn full_key(&self, key: &str) -> String {
        join_key(&self.prefix, key)
    }

    /// Strip the configured prefix from an absolute object key.
    fn relative_key(&self, key: &str) -> String {
        let prefix = self.prefix.trim_matches('/');
        if prefix.is_empty() {
            return key.to_string();
        }
        key.strip_prefix(prefix)
            .map(|rest| rest.trim_start_matches('/').to_string())
            .unwrap_or_else(|| key.to_string())
    }
}

impl StorageBackend for S3Backend {
    async fn test(&self) -> Result<(), String> {
        self.client
            .list_objects_v2()
            .bucket(&self.bucket)
            .prefix(join_key(&self.prefix, ""))
            .max_keys(1)
            .send()
            .await
            .map_err(err_chain)?;
        Ok(())
    }

    async fn put(&self, key: &str, body: Vec<u8>) -> Result<ObjectMeta, String> {
        let size = body.len() as i64;
        let resp = self
            .client
            .put_object()
            .bucket(&self.bucket)
            .key(self.full_key(key))
            .body(ByteStream::from(body))
            .send()
            .await
            .map_err(err_chain)?;
        Ok(ObjectMeta {
            key: key.to_string(),
            size,
            etag: resp.e_tag().map(str::to_string),
            last_modified: None,
        })
    }

    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, String> {
        let result = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(self.full_key(key))
            .send()
            .await;

        match result {
            Ok(resp) => {
                let data = resp
                    .body
                    .collect()
                    .await
                    .map_err(err_chain)?
                    .into_bytes()
                    .to_vec();
                Ok(Some(data))
            }
            Err(err) => {
                let service_err = err.into_service_error();
                if service_err.is_no_such_key() {
                    Ok(None)
                } else {
                    Err(err_chain(service_err))
                }
            }
        }
    }

    async fn list(&self, prefix: &str) -> Result<Vec<ObjectMeta>, String> {
        let full_prefix = join_key(&self.prefix, prefix);
        let mut out = Vec::new();
        let mut continuation: Option<String> = None;

        loop {
            let mut req = self
                .client
                .list_objects_v2()
                .bucket(&self.bucket)
                .prefix(&full_prefix);
            if let Some(token) = &continuation {
                req = req.continuation_token(token);
            }
            let resp = req.send().await.map_err(err_chain)?;

            for obj in resp.contents() {
                let Some(key) = obj.key() else { continue };
                out.push(ObjectMeta {
                    key: self.relative_key(key),
                    size: obj.size().unwrap_or(0),
                    etag: obj.e_tag().map(str::to_string),
                    last_modified: obj.last_modified().map(|d| d.secs()),
                });
            }

            if resp.is_truncated() == Some(true) {
                continuation = resp.next_continuation_token().map(str::to_string);
                if continuation.is_none() {
                    break;
                }
            } else {
                break;
            }
        }

        Ok(out)
    }

    async fn delete(&self, key: &str) -> Result<(), String> {
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(self.full_key(key))
            .send()
            .await
            .map_err(err_chain)?;
        Ok(())
    }
}
