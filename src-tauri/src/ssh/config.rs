//! Minimal `~/.ssh/config` parser used by the one-click import flow.
//!
//! We resolve each non-wildcard `Host` block into a candidate, and — crucially —
//! read the content of any referenced `IdentityFile` so the private key can be
//! fully *managed* (stored in the encrypted vault) rather than left as a loose
//! filesystem reference. This matches the product requirement that imported
//! hosts carry their associated resources inside LLMToolForge.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(serde::Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigCandidate {
    pub name: String,
    pub hostname: String,
    pub port: u32,
    pub username: String,
    pub proxy_jump: Option<String>,
    pub forward_agent: Option<bool>,
    pub identity_file: Option<String>,
    pub key_name: Option<String>,
    /// Plaintext PEM read from the IdentityFile, when readable.
    pub private_key: Option<String>,
    pub extra_options: HashMap<String, String>,
}

#[derive(Default)]
struct Block {
    aliases: Vec<String>,
    hostname: Option<String>,
    port: Option<u32>,
    username: Option<String>,
    proxy_jump: Option<String>,
    forward_agent: Option<bool>,
    identity_file: Option<String>,
    extra: HashMap<String, String>,
}

fn default_config_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("could not determine home directory")?;
    Ok(home.join(".ssh").join("config"))
}

/// Expand a leading `~` (and `~/`) against the user's home directory.
fn expand_tilde(p: &str) -> PathBuf {
    if let Some(rest) = p.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    } else if p == "~" {
        if let Some(home) = dirs::home_dir() {
            return home;
        }
    }
    PathBuf::from(p)
}

fn is_wildcard(alias: &str) -> bool {
    alias.contains('*') || alias.contains('?') || alias.starts_with('!')
}

fn block_to_candidate(block: &Block, config_dir: &Path) -> Option<SshConfigCandidate> {
    // Only emit blocks that name a single concrete host alias.
    let alias = block.aliases.iter().find(|a| !is_wildcard(a))?.clone();

    let hostname = block.hostname.clone().unwrap_or_else(|| alias.clone());
    let mut candidate = SshConfigCandidate {
        name: alias,
        hostname,
        port: block.port.unwrap_or(22),
        username: block.username.clone().unwrap_or_default(),
        proxy_jump: block.proxy_jump.clone(),
        forward_agent: block.forward_agent,
        identity_file: block.identity_file.clone(),
        key_name: None,
        private_key: None,
        extra_options: block.extra.clone(),
    };

    if let Some(identity) = &block.identity_file {
        let mut path = expand_tilde(identity);
        if path.is_relative() {
            path = config_dir.join(&path);
        }
        candidate.key_name = path.file_name().map(|n| n.to_string_lossy().to_string());
        if let Ok(content) = std::fs::read_to_string(&path) {
            candidate.private_key = Some(content);
        }
    }

    Some(candidate)
}

/// Parse the ssh config at `path` (or the default `~/.ssh/config`).
pub fn parse(path: Option<String>) -> Result<Vec<SshConfigCandidate>, String> {
    let config_path = match path {
        Some(p) if !p.trim().is_empty() => expand_tilde(p.trim()),
        _ => default_config_path()?,
    };
    let config_dir = config_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("cannot read {}: {e}", config_path.display()))?;

    let mut candidates = Vec::new();
    let mut current: Option<Block> = None;

    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        // Keywords are separated from values by whitespace and/or a single '='.
        let (keyword, value) = match line.split_once(|c: char| c.is_whitespace() || c == '=') {
            Some((k, v)) => (k.trim(), v.trim_start_matches(['=', ' ', '\t']).trim()),
            None => (line, ""),
        };
        let key_lower = keyword.to_ascii_lowercase();

        if key_lower == "host" {
            if let Some(block) = current.take() {
                if let Some(c) = block_to_candidate(&block, &config_dir) {
                    candidates.push(c);
                }
            }
            let aliases = value
                .split_whitespace()
                .map(str::to_string)
                .collect::<Vec<_>>();
            current = Some(Block {
                aliases,
                ..Default::default()
            });
            continue;
        }

        let Some(block) = current.as_mut() else {
            continue; // options before any Host (Match blocks unsupported)
        };

        match key_lower.as_str() {
            "hostname" => block.hostname = Some(value.to_string()),
            "port" => block.port = value.parse().ok(),
            "user" => block.username = Some(value.to_string()),
            "proxyjump" => block.proxy_jump = Some(value.to_string()),
            "forwardagent" => {
                block.forward_agent = Some(matches!(
                    value.to_ascii_lowercase().as_str(),
                    "yes" | "true" | "on" | "1"
                ))
            }
            "identityfile" => {
                // Keep the first IdentityFile (OpenSSH tries them in order).
                if block.identity_file.is_none() {
                    block.identity_file = Some(value.to_string());
                }
            }
            _ => {
                if !value.is_empty() {
                    block.extra.insert(keyword.to_string(), value.to_string());
                }
            }
        }
    }

    if let Some(block) = current.take() {
        if let Some(c) = block_to_candidate(&block, &config_dir) {
            candidates.push(c);
        }
    }

    Ok(candidates)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_blocks_and_skips_wildcards() {
        let dir = std::env::temp_dir().join(format!("ltf-ssh-{}", rand::random::<u64>()));
        std::fs::create_dir_all(&dir).unwrap();
        let cfg = dir.join("config");
        std::fs::write(
            &cfg,
            "Host *\n  ForwardAgent yes\n\nHost prod\n  HostName 10.0.0.1\n  Port 2222\n  User deploy\n  ProxyJump bastion\n",
        )
        .unwrap();
        let out = parse(Some(cfg.to_string_lossy().to_string())).unwrap();
        assert_eq!(out.len(), 1);
        let c = &out[0];
        assert_eq!(c.name, "prod");
        assert_eq!(c.hostname, "10.0.0.1");
        assert_eq!(c.port, 2222);
        assert_eq!(c.username, "deploy");
        assert_eq!(c.proxy_jump.as_deref(), Some("bastion"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_identity_file_content() {
        let dir = std::env::temp_dir().join(format!("ltf-ssh-{}", rand::random::<u64>()));
        std::fs::create_dir_all(&dir).unwrap();
        let key = dir.join("id_test");
        std::fs::write(&key, "PRIVATE-KEY-BODY").unwrap();
        let cfg = dir.join("config");
        std::fs::write(
            &cfg,
            format!("Host box\n  HostName h\n  IdentityFile {}\n", key.display()),
        )
        .unwrap();
        let out = parse(Some(cfg.to_string_lossy().to_string())).unwrap();
        assert_eq!(out[0].private_key.as_deref(), Some("PRIVATE-KEY-BODY"));
        assert_eq!(out[0].key_name.as_deref(), Some("id_test"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
