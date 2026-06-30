//! SSH management: encrypted credential vault, `~/.ssh/config` import, and
//! interactive terminal sessions over a pure-Rust `russh` client.

mod config;
mod session;
mod vault;

pub use session::SshManager;

use config::SshConfigCandidate;

/// Seal a plaintext credential field into an `enc:v1:` envelope for storage.
#[tauri::command]
pub fn ssh_seal(value: String) -> Result<String, String> {
    vault::seal(&value)
}

/// Open (decrypt) a sealed credential field for just-in-time use.
#[tauri::command]
pub fn ssh_open(value: String) -> Result<String, String> {
    vault::open(&value)
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
