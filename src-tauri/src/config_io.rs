//! Plaintext config file IO for one-click model-config export / import.
//!
//! Unlike `fs_tools`, these commands are not sandbox-bound: the path comes from
//! a user-driven save/open dialog, so the user has already chosen where the file
//! lives. The payload is plain UTF-8 JSON (no encryption) by design — it is
//! meant for sharing model connections across the user's own dev machines.

use std::fs;

/// Write `contents` verbatim to `path` (plaintext JSON chosen via a save dialog).
#[tauri::command]
pub fn model_config_export(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents.as_bytes()).map_err(|e| format!("write failed: {e}"))
}

/// Read a plaintext JSON config file picked via an open dialog.
#[tauri::command]
pub fn model_config_import(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("read failed: {e}"))
}
