//! Login-shell PATH recovery for spawned child processes.
//!
//! When the app is launched from the macOS Finder/Dock (or a Linux desktop
//! launcher) it inherits a minimal `PATH` (typically `/usr/bin:/bin:/usr/sbin:
//! /sbin`) that omits the directories where user-installed tooling lives —
//! `nvm`, Homebrew, `~/.local/bin`, `pnpm`, etc. As a result, spawning a stdio
//! MCP server like Playwright (`npx @playwright/mcp@latest`) fails with
//! `No such file or directory (os error 2)` because `npx`/`node`/`uvx` are not
//! on the process `PATH`.
//!
//! [`augmented_path`] recovers the real `PATH` by asking the user's login shell
//! for it once (cached for the process lifetime), merging it with whatever the
//! process already has. Spawn sites set this on the child's environment so
//! command lookup resolves the same binaries the user sees in their terminal.

use std::sync::OnceLock;
use std::time::Duration;

/// Cached, login-shell-augmented `PATH`. Computed lazily on first use.
static AUGMENTED_PATH: OnceLock<String> = OnceLock::new();

/// Return a `PATH` value augmented with the user's login-shell `PATH`.
///
/// The result is cached for the lifetime of the process. On non-unix targets,
/// or when the login shell cannot be queried, the current process `PATH` is
/// returned unchanged.
pub fn augmented_path() -> &'static str {
    AUGMENTED_PATH.get_or_init(compute_augmented_path)
}

/// Set the augmented `PATH` on a `std::process::Command`, unless the caller has
/// already provided an explicit `PATH` via configured env vars.
pub fn apply_to_command(cmd: &mut std::process::Command) {
    cmd.env("PATH", augmented_path());
}

/// Set the augmented `PATH` on a `tokio::process::Command`.
pub fn apply_to_tokio_command(cmd: &mut tokio::process::Command) {
    cmd.env("PATH", augmented_path());
}

fn compute_augmented_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();

    #[cfg(unix)]
    {
        if let Some(shell_path) = query_login_shell_path() {
            return merge_paths(&shell_path, &current);
        }
    }

    current
}

/// Merge two `PATH` strings, keeping `primary` order first and appending any
/// entries from `secondary` that are not already present.
#[cfg(unix)]
fn merge_paths(primary: &str, secondary: &str) -> String {
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<&str> = Vec::new();
    for part in primary
        .split(':')
        .chain(secondary.split(':'))
        .filter(|p| !p.is_empty())
    {
        if seen.insert(part) {
            out.push(part);
        }
    }
    out.join(":")
}

/// Ask the user's login shell for its `PATH`.
///
/// Runs the login+interactive shell so `~/.zprofile` / `~/.zshrc` (and the
/// bash equivalents) are sourced, then prints `$PATH` delimited by sentinels so
/// we can extract it even if an rc file writes noise to stdout. Bounded by a
/// short timeout so a slow/blocking rc file can never hang startup.
#[cfg(unix)]
fn query_login_shell_path() -> Option<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use wait_timeout::ChildExt;

    const START: &str = "__LTF_PATH_START__";
    const END: &str = "__LTF_PATH_END__";

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let script = format!("printf '{START}%s{END}' \"$PATH\"");

    let mut child = Command::new(&shell)
        .args(["-ilc", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    // Bound the wait so a misbehaving rc file cannot stall the app.
    let timeout = Duration::from_secs(5);
    let waited = child.wait_timeout(timeout).ok().flatten();
    if waited.is_none() {
        let _ = child.kill();
        let _ = child.wait();
        return None;
    }

    let mut stdout = String::new();
    child.stdout.take()?.read_to_string(&mut stdout).ok()?;

    let start = stdout.find(START)? + START.len();
    let end = stdout[start..].find(END)? + start;
    let path = stdout[start..end].trim();
    if path.is_empty() {
        None
    } else {
        Some(path.to_string())
    }
}
