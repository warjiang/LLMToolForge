//! SSH management: encrypted credential vault, `~/.ssh/config` import, and
//! interactive terminal sessions over a pure-Rust `russh` client.

mod config;
mod session;
mod vault;

pub use session::SshManager;

use config::SshConfigCandidate;

use crate::storage::crypto::EncryptionConfig;

/// Seal a plaintext credential field into a sealed envelope for storage.
///
/// When `encryption` carries the user's sync passphrase, a portable `enc:v2:`
/// envelope is produced so the credential can be opened on any synced device;
/// otherwise it falls back to the device-local `enc:v1:` keychain envelope.
#[tauri::command]
pub fn ssh_seal(value: String, encryption: Option<EncryptionConfig>) -> Result<String, String> {
    vault::seal(&value, encryption.as_ref())
}

/// Open (decrypt) a sealed credential field for just-in-time use. `encryption`
/// is required to open portable `enc:v2:` envelopes.
#[tauri::command]
pub fn ssh_open(value: String, encryption: Option<EncryptionConfig>) -> Result<String, String> {
    vault::open(&value, encryption.as_ref())
}

/// Re-seal a credential into a portable `enc:v2:` envelope so it survives
/// cross-device sync. Used to migrate legacy device-local (`enc:v1:`) values.
#[tauri::command]
pub fn ssh_reseal(value: String, encryption: EncryptionConfig) -> Result<String, String> {
    vault::reseal_to_portable(&value, &encryption)
}

/// Parse `~/.ssh/config` (or a custom path) into importable host candidates,
/// reading referenced IdentityFile contents so keys can be fully managed.
#[tauri::command]
pub fn ssh_parse_config(path: Option<String>) -> Result<Vec<SshConfigCandidate>, String> {
    config::parse(path)
}

/// Encrypt `plaintextJson` with `passphrase` and write a portable `.ltfvault`.
#[tauri::command]
pub fn ssh_vault_export(
    path: String,
    passphrase: String,
    plaintext_json: String,
) -> Result<(), String> {
    vault::export_file(&path, &passphrase, &plaintext_json)
}

/// Read and decrypt a portable `.ltfvault`, returning the plaintext JSON.
#[tauri::command]
pub fn ssh_vault_import(path: String, passphrase: String) -> Result<String, String> {
    vault::import_file(&path, &passphrase)
}

// Glob re-export so `tauri::generate_handler!` can resolve the hidden macro
// items (`__cmd__*`) that back each session command, not just the fns.
pub use session::*;
