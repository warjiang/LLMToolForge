//! SSH management: encrypted credential vault, `~/.ssh/config` import, and
//! interactive terminal sessions over a pure-Rust `russh` client.

mod config;
mod session;
mod vault;

pub use session::SshManager;

use config::SshConfigCandidate;

/// Append a timestamped diagnostic line to `~/Library/Logs/llmtoolforge-ssh.log`
/// (falling back to the OS temp dir) and mirror it to stderr. Used to pinpoint
/// where an interactive connection stalls. Never logs secret material.
pub(crate) fn debug_log(msg: &str) {
    use std::io::Write;
    let path = dirs::home_dir()
        .map(|h| h.join("Library/Logs/llmtoolforge-ssh.log"))
        .unwrap_or_else(|| std::env::temp_dir().join("llmtoolforge-ssh.log"));
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let _ = writeln!(f, "[{ms}] {msg}");
    }
    eprintln!("[ssh] {msg}");
}

/// Bridge so the frontend can record its own connect-flow breadcrumbs into the
/// same log file, making it possible to tell a UI-side stall (e.g. waiting on a
/// keychain prompt during vault decryption) from a transport-side one.
#[tauri::command]
pub fn ssh_debug_log(message: String) {
    debug_log(&format!("[frontend] {message}"));
}

/// Seal a plaintext credential field into an `enc:v1:` envelope for storage.
#[tauri::command]
pub fn ssh_seal(value: String) -> Result<String, String> {
    vault::seal(&value)
}

/// Open (decrypt) a sealed credential field for just-in-time use.
#[tauri::command]
pub fn ssh_open(value: String) -> Result<String, String> {
    debug_log(&format!("ssh_open: decrypting field (len={})", value.len()));
    let r = vault::open(&value);
    match &r {
        Ok(v) => debug_log(&format!("ssh_open: done (plaintext len={})", v.len())),
        Err(e) => debug_log(&format!("ssh_open: FAILED: {e}")),
    }
    r
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
