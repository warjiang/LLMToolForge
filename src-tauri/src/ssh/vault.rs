//! At-rest encryption for SSH credentials.
//!
//! Sensitive fields (password, private key, key passphrase) are sealed with
//! AES-256-GCM using a random 32-byte data key that is generated once and kept
//! in the OS keychain (macOS Keychain / Windows Credential Manager / Linux
//! Secret Service) via the `keyring` crate. The key never leaves the device and
//! never lands in the plaintext store file.
//!
//! A sealed value is the string `enc:v1:<base64(nonce || ciphertext+tag)>`.
//!
//! For device-independent export/import, a separate passphrase-based container
//! (`.ltfvault`) reuses the sync layer's Argon2id + AES-256-GCM primitives so
//! the file can be decrypted on any device that knows the passphrase.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use keyring::Entry;
use rand::RngCore;

use crate::storage::crypto::{self, EncryptionConfig};

const KEYRING_SERVICE: &str = "llmtoolforge";
const KEYRING_ACCOUNT: &str = "ssh-vault-key";
const SEAL_PREFIX: &str = "enc:v1:";
const NONCE_LEN: usize = 12;

// Export container: magic("LTFV") | version(1) | salt(16) | sync-crypto blob.
const FILE_MAGIC: &[u8; 4] = b"LTFV";
const FILE_VERSION: u8 = 1;
const SALT_LEN: usize = 16;

fn load_or_create_key() -> Result<[u8; 32], String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("keychain unavailable: {e}"))?;
    match entry.get_password() {
        Ok(b64) => {
            let bytes = B64
                .decode(b64.trim())
                .map_err(|e| format!("corrupt vault key: {e}"))?;
            if bytes.len() != 32 {
                return Err("vault key has unexpected length".into());
            }
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            Ok(key)
        }
        Err(keyring::Error::NoEntry) => {
            let mut key = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut key);
            entry
                .set_password(&B64.encode(key))
                .map_err(|e| format!("failed to store vault key: {e}"))?;
            Ok(key)
        }
        Err(e) => Err(format!("keychain error: {e}")),
    }
}

fn cipher() -> Result<Aes256Gcm, String> {
    let key = load_or_create_key()?;
    Ok(Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key)))
}

/// Encrypt a plaintext field into an `enc:v1:` envelope. Empty input is passed
/// through unchanged so callers can seal optional fields uniformly.
pub fn seal(plaintext: &str) -> Result<String, String> {
    if plaintext.is_empty() {
        return Ok(String::new());
    }
    if is_sealed(plaintext) {
        return Ok(plaintext.to_string());
    }
    let cipher = cipher()?;
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext.as_bytes())
        .map_err(|_| "seal failed".to_string())?;
    let mut blob = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    blob.extend_from_slice(&nonce_bytes);
    blob.extend_from_slice(&ciphertext);
    Ok(format!("{SEAL_PREFIX}{}", B64.encode(blob)))
}

/// Decrypt an `enc:v1:` envelope back to plaintext. Non-sealed (e.g. empty)
/// values are returned as-is.
pub fn open(value: &str) -> Result<String, String> {
    if value.is_empty() {
        return Ok(String::new());
    }
    let Some(b64) = value.strip_prefix(SEAL_PREFIX) else {
        return Ok(value.to_string());
    };
    let blob = B64
        .decode(b64.trim())
        .map_err(|e| format!("corrupt sealed value: {e}"))?;
    if blob.len() <= NONCE_LEN {
        return Err("sealed value too short".into());
    }
    let cipher = cipher()?;
    let (nonce, ciphertext) = blob.split_at(NONCE_LEN);
    let plaintext = cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| "open failed — vault key mismatch or corrupted data".to_string())?;
    String::from_utf8(plaintext).map_err(|e| format!("invalid utf-8: {e}"))
}

pub fn is_sealed(value: &str) -> bool {
    value.starts_with(SEAL_PREFIX)
}

/// Encrypt `plaintext_json` with a user passphrase and write a portable vault
/// container to `path`.
pub fn export_file(path: &str, passphrase: &str, plaintext_json: &str) -> Result<(), String> {
    let salt_b64 = crypto::generate_salt_b64();
    let enc = EncryptionConfig {
        passphrase: passphrase.to_string(),
        salt_b64: salt_b64.clone(),
    };
    let blob = crypto::encrypt(&enc, plaintext_json.as_bytes())?;
    let salt = B64
        .decode(salt_b64.trim())
        .map_err(|e| format!("invalid salt: {e}"))?;
    if salt.len() != SALT_LEN {
        return Err("unexpected salt length".into());
    }
    let mut out = Vec::with_capacity(4 + 1 + SALT_LEN + blob.len());
    out.extend_from_slice(FILE_MAGIC);
    out.push(FILE_VERSION);
    out.extend_from_slice(&salt);
    out.extend_from_slice(&blob);
    std::fs::write(path, out).map_err(|e| format!("write failed: {e}"))
}

/// Read and decrypt a portable vault container, returning the plaintext JSON.
pub fn import_file(path: &str, passphrase: &str) -> Result<String, String> {
    let data = std::fs::read(path).map_err(|e| format!("read failed: {e}"))?;
    let header = 4 + 1 + SALT_LEN;
    if data.len() < header || &data[0..4] != FILE_MAGIC {
        return Err("not a LLMToolForge vault file".into());
    }
    if data[4] != FILE_VERSION {
        return Err(format!("unsupported vault file version: {}", data[4]));
    }
    let salt = &data[5..header];
    let blob = &data[header..];
    let enc = EncryptionConfig {
        passphrase: passphrase.to_string(),
        salt_b64: B64.encode(salt),
    };
    let plaintext = crypto::decrypt(&enc, blob)?;
    String::from_utf8(plaintext).map_err(|e| format!("invalid utf-8: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_import_round_trip() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("ltf-vault-test-{}.ltfvault", rand::random::<u64>()));
        let path = path.to_string_lossy().to_string();
        let json = r#"{"hosts":[{"id":"a","password":"hunter2"}]}"#;
        export_file(&path, "correct horse", json).unwrap();
        let back = import_file(&path, "correct horse").unwrap();
        assert_eq!(back, json);
        assert!(import_file(&path, "wrong").is_err());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn seal_prefix_detection() {
        assert!(is_sealed("enc:v1:abc"));
        assert!(!is_sealed("plain"));
        assert_eq!(open("").unwrap(), "");
        assert_eq!(seal("").unwrap(), "");
    }
}
