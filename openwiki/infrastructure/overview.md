---
type: System
title: Infrastructure — Storage Sync, SSH, Sandbox, and Cross-Cutting Services
description: Cross-cutting infrastructure in LLMToolForge — encrypted S3 storage sync, SSH host management with credential vault, sandboxed command execution, DuckDB data tools, system tray, web fetch/search, and file preview.
tags: [infrastructure, storage, sync, ssh, sandbox, tray, duckdb, encryption]
---

# Infrastructure

Cross-cutting infrastructure services that support the application's core features: encrypted storage sync, SSH terminal access, sandboxed execution, data analysis tools, system tray, and web utilities.

## Storage Sync

The storage sync system encrypts local data and synchronizes it to S3-compatible object storage, enabling multi-device usage with end-to-end encryption.

**Rust backend**: [`/src-tauri/src/storage/`](/src-tauri/src/storage/)  
**Frontend sync store**: [`/src/store/sync.ts`](/src/store/sync.ts)  
**Sync registry**: [`/src/data/sync/registry.ts`](/src/data/sync/registry.ts)  
**UI**: [`/src/pages/settings/StorageSyncCard.tsx`](/src/pages/settings/StorageSyncCard.tsx)

### Architecture

```
┌──────────────────────────────────────────────────┐
│  Frontend (sync registry)                        │
│  ┌──────────────────────────────────────────┐    │
│  │  Resources: apiKeys, skills, mcpServers, │    │
│  │  agentDefinitions, connectors, sshHosts  │    │
│  └──────────────────┬───────────────────────┘    │
└─────────────────────┼────────────────────────────┘
                      │ invoke()
┌─────────────────────┼────────────────────────────┐
│  Rust Storage Layer │                            │
│  ┌──────────────────▼───────────────────────┐    │
│  │  crypto.rs                                │    │
│  │  ┌──────────┐  ┌──────────────────────┐  │    │
│  │  │ Argon2id │  │ AES-256-GCM          │  │    │
│  │  │ KDF      │─▶│ per-object encryption │  │    │
│  │  └──────────┘  └──────────┬───────────┘  │    │
│  └────────────────────────────┼──────────────┘    │
│  ┌────────────────────────────▼──────────────┐    │
│  │  s3.rs / backend.rs                        │    │
│  │  S3-compatible upload/download             │    │
│  └────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────┘
```

### Encryption

- **Key derivation**: User passphrase → Argon2id → AES-256 key
- **Per-object encryption**: Each resource is encrypted independently with AES-256-GCM
- **Self-describing format**: `LTFS` magic bytes prefix encrypted blobs
- **Salt sharing**: KDF salt is stored in the plaintext sync manifest so multiple devices can derive the same key
- **Keys never leave the device**: Passphrase and derived keys are never uploaded

### Sync Mechanics

- **Per-resource sync**: Each resource type (API keys, skills, MCP servers, etc.) is encrypted and uploaded as a separate object
- **Last-write-wins merging**: Resources are merged by `updatedAt` timestamp; newer versions win
- **Tombstone deletes**: Deleted resources propagate as tombstones to prevent resurrection on merge
- **Versioned history snapshots**: Recent addition (PR #50) that preserves historical versions for recovery
- **Extensible registry**: Adding a new syncable resource requires only adding one line to [`/src/data/sync/registry.ts`](/src/data/sync/registry.ts)

### S3 Backend

- Supports AWS S3 and S3-compatible services (MinIO, Cloudflare R2)
- Configurable endpoint (for custom S3-compatible providers) and path-style addressing
- Uses `rustls-ring` TLS stack to avoid `aws-lc-sys` compilation requirements on Windows CI
- Static AK/SK credentials (no `aws-config` dependency)
- Desktop-only: S3 operations execute in Rust; disabled in browser dev mode

### Tauri Commands

| Command | Purpose |
|---|---|
| `storage_configure` | Set S3 credentials, bucket, region, passphrase |
| `storage_push` | Encrypt and upload all registered resources |
| `storage_pull` | Download, decrypt, and merge remote state |
| `storage_status` | Check sync configuration state |

## SSH

SSH host management with a pure-Rust client and credential vault.

**Rust backend**: [`/src-tauri/src/ssh/`](/src-tauri/src/ssh/)  
**Frontend client**: [`/src/lib/ssh/client.ts`](/src/lib/ssh/client.ts)  
**UI**: [`/src/pages/ssh/SshPage.tsx`](/src/pages/ssh/SshPage.tsx)

### Modules

| Module | Purpose |
|---|---|
| [`mod.rs`](/src-tauri/src/ssh/mod.rs) | SSH manager — connect/disconnect, config import, vault operations |
| [`session.rs`](/src-tauri/src/ssh/session.rs) | Interactive PTY sessions via [`russh`](https://github.com/warp-tech/russh) (pure Rust SSH) |
| [`vault.rs`](/src-tauri/src/ssh/vault.rs) | AES-256-GCM credential vault with two envelope types |
| [`config.rs`](/src-tauri/src/ssh/config.rs) | `~/.ssh/config` parser with `IdentityFile` inlining |

### Features

- **Host management**: Add, edit, delete, and clone SSH hosts (clone feature added in PR #62 for fast near-identical machine setup)
- **Terminal sessions**: Full PTY terminal with resize support via xterm.js
- **Credential vault**: Two envelope types:
  - `enc:v1:` — Device-local, key stored in OS keychain (macOS Keychain / Windows Credential Manager / Secret Service)
  - `enc:v2:` — Portable, key derived from sync passphrase
- **Config import**: Parse `~/.ssh/config` and import hosts with their `IdentityFile` contents inlined
- **Vault export/import**: `.ltfvault` file-based credential sharing
- **SSH import dialog**: Bulk import from standard SSH config format

Tauri commands: `ssh_connect`, `ssh_disconnect`, `ssh_write`, `ssh_resize`, plus vault and config import commands.

## Sandbox

The sandbox system controls what commands [agents](/openwiki/agent/overview.md) can execute, using macOS Seatbelt on Apple platforms.

**Implementation**: [`/src-tauri/src/lib.rs`](/src-tauri/src/lib.rs) (`run_sandboxed_command`)  
**Frontend tools**: [`/src-tauri/src/fs_tools/mod.rs`](/src-tauri/src/fs_tools/mod.rs)

### Sandbox Modes

| Mode | macOS | Other Platforms | Description |
|---|---|---|---|
| `read-only` | Seatbelt profile | Process isolation | No writes; read-only filesystem access |
| `workspace-write` | Seatbelt profile | Process isolation | Read + write within workspace directory |
| `danger-full-access` | No sandbox | No sandbox | Full filesystem access (user opt-in) |

### Command Execution

- Timeout: Configurable per command, defaults to 30s, clamped 1s–120s
- Environment: Minimal — only `PATH`, `HOME`, `TMPDIR`; safe env vars from caller
- Temporary directory: Per-command isolated temp dir
- macOS Seatbelt: `sandbox-exec` with generated profiles
- CWD: Falls back to a managed sandbox directory when no workspace is set

### PATH Recovery

A key infrastructure concern: when the app is launched from Finder/Dock (macOS), it doesn't inherit the shell's `PATH`. The [`/src-tauri/src/proc_env.rs`](/src-tauri/src/proc_env.rs) module solves this:

1. On startup, queries the user's login shell (`zsh`/`bash`) for its real `PATH`
2. Runs the query on a background thread
3. Caches the result in a `OnceLock` for the app's lifetime
4. Recent fix (PR #62): stops caching failed lookups, ensuring retries on subsequent calls

This is critical for finding `npx`, `uvx`, `pnpm`, and other tools the agent might invoke.

## Data Tools

DuckDB-powered data analysis tools for the agent.

**Implementation**: [`/src-tauri/src/data_tools/`](/src-tauri/src/data_tools/)

| Module | Purpose |
|---|---|
| [`mod.rs`](/src-tauri/src/data_tools/mod.rs) | `duckdb_query` — run SQL queries against data. `data_chart_html` / `data_report_html` — generate ECharts visualizations. |
| [`artifact.rs`](/src-tauri/src/data_tools/artifact.rs) | Incremental HTML artifact builder with live reload for the preview server |

## System Tray

Added in PR #61, the system tray provides background operation and at-a-glance status.

**Implementation**: [`/src-tauri/src/tray.rs`](/src-tauri/src/tray.rs)

### Features

- **Background run**: Closing the window hides to tray instead of quitting
- **Dock reopen**: Clicking the Dock icon re-shows the window (macOS)
- **Usage stats**: Refresh loop updates per-model usage statistics every 5 seconds
- **Sidecar controls**: Start/stop the Unified API gateway and Connector from the tray menu
- **Bilingual**: Labels adapt to the app's zh/en language setting

The tray also handles macOS-specific UX: tray popup behavior, Dock reopen, and screenshot preview timing (PR #63).

## File Preview

A local static HTTP server serves agent-generated artifacts, with image viewing support.

**Implementation**: [`/src-tauri/src/preview.rs`](/src-tauri/src/preview.rs)

### Features

- **Artifact server**: Serves HTML reports, charts, and other generated files
- **Zoomable image viewer**: Click images to open a zoomable overlay (PR #60)
- **Open in system**: Button to open files in the system's default application
- **Media preview**: Inline display of agent-generated images (PR #56, #60)

## Web Fetch and Search

| Module | File | Purpose |
|---|---|---|
| Web Fetch (headless) | [`/src-tauri/src/web_fetch.rs`](/src-tauri/src/web_fetch.rs) | HTTP page fetching with HTML-to-text extraction via `scraper` crate |
| Web Fetch (rendered) | [`/src-tauri/src/web_fetch_render.rs`](/src-tauri/src/web_fetch_render.rs) | JS-rendered page fetch via offscreen native webview (shares app cookie jar) for login-walled sites |
| Web Search | [`/src-tauri/src/web_search.rs`](/src-tauri/src/web_search.rs) | DuckDuckGo no-JS scraper for built-in web search |

## In-App Browser

A child webview browser for browsing within the app.

**Implementation**: [`/src-tauri/src/browser.rs`](/src-tauri/src/browser.rs)  
**UI**: [`/src/pages/browser/BrowserPage.tsx`](/src/pages/browser/BrowserPage.tsx)

Commands: `browser_create`, `browser_navigate`, `browser_go_back`, `browser_go_forward`, `browser_reload`, `browser_bounds`, `browser_history`, `browser_destroy`, etc.
