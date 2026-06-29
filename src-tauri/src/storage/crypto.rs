//! Client-side encryption for synced data.
//!
//! Keys are derived from a user passphrase with Argon2id; the derived key never
//! leaves the device and is never uploaded. Each encrypted object is a small
//! self-describing blob:
//!
//! ```text
//! magic("LTFS") | version(1) | nonce(12) | AES-256-GCM(ciphertext+tag)
//! ```
//!
//! The KDF salt is *not* stored in the blob — it lives (in plaintext, since a
//! salt is not secret) in the remote sync manifest so any device that knows the
//! passphrase can derive the same key.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use argon2::Argon2;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;

const MAGIC: &[u8; 4] = b"LTFS";
const VERSION: u8 = 1;
const NONCE_LEN: usize = 12;
const HEADER_LEN: usize = 4 + 1 + NONCE_LEN; // magic + version + nonce

/// Encryption parameters supplied by the frontend. Mirrors the TS
/// `EncryptionConfig` (serde camelCase).
#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EncryptionConfig {
    pub passphrase: String,
    /// Base64-encoded KDF salt (16 random bytes), shared via the manifest.
    pub salt_b64: String,
}

fn derive_key(passphrase: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    if salt.len() < 8 {
        return Err("encryption salt must be at least 8 bytes".into());
    }
    if passphrase.is_empty() {
        return Err("encryption passphrase must not be empty".into());
    }
    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|e| format!("key derivation failed: {e}"))?;
    Ok(key)
}

pub fn encrypt(enc: &EncryptionConfig, plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let salt = B64
        .decode(enc.salt_b64.trim())
        .map_err(|e| format!("invalid salt: {e}"))?;
    let key = derive_key(&enc.passphrase, &salt)?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| "encryption failed".to_string())?;

    let mut out = Vec::with_capacity(HEADER_LEN + ciphertext.len());
    out.extend_from_slice(MAGIC);
    out.push(VERSION);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub fn decrypt(enc: &EncryptionConfig, blob: &[u8]) -> Result<Vec<u8>, String> {
    if blob.len() < HEADER_LEN || &blob[0..4] != MAGIC {
        return Err("not an LLMToolForge encrypted object".into());
    }
    let version = blob[4];
    if version != VERSION {
        return Err(format!("unsupported encrypted object version: {version}"));
    }
    let salt = B64
        .decode(enc.salt_b64.trim())
        .map_err(|e| format!("invalid salt: {e}"))?;
    let key = derive_key(&enc.passphrase, &salt)?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

    let nonce = Nonce::from_slice(&blob[5..HEADER_LEN]);
    let ciphertext = &blob[HEADER_LEN..];
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "decryption failed — wrong passphrase or corrupted data".to_string())
}

/// Generate a fresh base64-encoded 16-byte salt for first-time setup.
pub fn generate_salt_b64() -> String {
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    B64.encode(salt)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(pass: &str) -> EncryptionConfig {
        EncryptionConfig {
            passphrase: pass.into(),
            salt_b64: generate_salt_b64(),
        }
    }

    #[test]
    fn round_trip() {
        let enc = cfg("correct horse battery staple");
        let data = b"{\"items\":[{\"id\":\"a\"}]}";
        let blob = encrypt(&enc, data).unwrap();
        assert_eq!(&blob[0..4], MAGIC);
        let back = decrypt(&enc, &blob).unwrap();
        assert_eq!(back, data);
    }

    #[test]
    fn wrong_passphrase_fails() {
        let enc = cfg("right");
        let blob = encrypt(&enc, b"secret").unwrap();
        let bad = EncryptionConfig {
            passphrase: "wrong".into(),
            salt_b64: enc.salt_b64.clone(),
        };
        assert!(decrypt(&bad, &blob).is_err());
    }

    #[test]
    fn tampered_header_fails() {
        let enc = cfg("pw");
        let mut blob = encrypt(&enc, b"x").unwrap();
        blob[0] = b'X';
        assert!(decrypt(&enc, &blob).is_err());
    }

    #[test]
    fn empty_passphrase_rejected() {
        let enc = EncryptionConfig {
            passphrase: String::new(),
            salt_b64: generate_salt_b64(),
        };
        assert!(encrypt(&enc, b"x").is_err());
    }
}
