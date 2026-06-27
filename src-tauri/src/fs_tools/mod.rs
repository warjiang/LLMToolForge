//! Filesystem tools for the in-app Pi agent.
//!
//! These commands back the agent's internal `read` / `write` / `edit` / `ls` /
//! `grep` tools. They run from the Tauri backend (desktop only) and honour the
//! same sandbox modes as `run_sandboxed_command`:
//!
//! - `read-only`       : reads / listing / grep allowed, writes denied.
//! - `workspace-write` : writes allowed only inside the execution root (or temp).
//! - `danger-full-access` : no path restrictions.
//!
//! Reads are always allowed anywhere (parity with the bash sandbox, which uses
//! `allow default` + `deny file-write`). Listing and grep are bounded to the
//! execution root unless full access is granted, to keep their blast radius small.

use std::fs;
use std::path::{Component, Path, PathBuf};

use regex::RegexBuilder;
use serde::{Deserialize, Serialize};

use crate::default_sandbox_dir;

/// Hard cap on bytes returned by `fs_read` (256 KiB).
const MAX_READ_BYTES: usize = 256 * 1024;
/// Hard cap on bytes scanned per file by `fs_grep` (2 MiB).
const MAX_GREP_FILE_BYTES: u64 = 2 * 1024 * 1024;
/// Default cap on matches returned by `fs_grep`.
const DEFAULT_GREP_LIMIT: usize = 200;
/// Directories never descended into during listing / grep.
const SKIP_DIRS: [&str; 6] = [".git", "node_modules", "target", "dist", ".next", ".turbo"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadRequest {
    workspace_root: String,
    path: String,
    sandbox_mode: String,
    /// 1-based line to start from (inclusive).
    offset: Option<usize>,
    /// Maximum number of lines to return.
    limit: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadResponse {
    path: String,
    content: String,
    truncated: bool,
    line_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsWriteRequest {
    workspace_root: String,
    path: String,
    content: String,
    sandbox_mode: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsWriteResponse {
    path: String,
    bytes_written: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEditRequest {
    workspace_root: String,
    path: String,
    old_str: String,
    new_str: String,
    replace_all: Option<bool>,
    sandbox_mode: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEditResponse {
    path: String,
    replaced: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsListRequest {
    workspace_root: String,
    path: Option<String>,
    sandbox_mode: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsListEntry {
    name: String,
    kind: String,
    size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsListResponse {
    path: String,
    entries: Vec<FsListEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsGrepRequest {
    workspace_root: String,
    pattern: String,
    path: Option<String>,
    /// Optional case-insensitive flag (default false).
    ignore_case: Option<bool>,
    /// Optional cap on matches returned.
    max_results: Option<usize>,
    sandbox_mode: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsGrepMatch {
    path: String,
    line: usize,
    text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsGrepResponse {
    matches: Vec<FsGrepMatch>,
    truncated: bool,
}

fn validate_mode(mode: &str) -> Result<(), String> {
    if matches!(mode, "read-only" | "workspace-write" | "danger-full-access") {
        Ok(())
    } else {
        Err(format!("未知沙箱模式: {mode}"))
    }
}

/// Lexically normalize a path (resolve `.` / `..` without touching the disk so
/// it also works for files that do not exist yet, e.g. write targets).
fn normalize_lexical(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::ParentDir => {
                if !out.pop() {
                    out.push("..");
                }
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn effective_root(workspace_root: &str) -> Result<PathBuf, String> {
    if workspace_root.trim().is_empty() {
        default_sandbox_dir().map(|p| normalize_lexical(&p))
    } else {
        Ok(normalize_lexical(Path::new(workspace_root)))
    }
}

/// Resolve `path` against the execution root and normalize it.
fn resolve(workspace_root: &str, path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("缺少路径".to_string());
    }
    let candidate = Path::new(path);
    let base = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        effective_root(workspace_root)?.join(candidate)
    };
    Ok(normalize_lexical(&base))
}

fn is_within(root: &Path, path: &Path) -> bool {
    let root = normalize_lexical(root);
    path.starts_with(&root)
}

/// Enforce write permissions for the active sandbox mode.
fn check_write(mode: &str, workspace_root: &str, target: &Path) -> Result<(), String> {
    match mode {
        "read-only" => Err("只读沙箱：写入被拒绝".to_string()),
        "workspace-write" => {
            let root = effective_root(workspace_root)?;
            let tmp = normalize_lexical(&std::env::temp_dir());
            if is_within(&root, target) || is_within(&tmp, target) {
                return Ok(());
            }
            #[cfg(unix)]
            if is_within(Path::new("/tmp"), target) {
                return Ok(());
            }
            #[cfg(target_os = "macos")]
            if is_within(Path::new("/private/tmp"), target) {
                return Ok(());
            }
            Err(format!(
                "workspace-write 沙箱：仅允许写入执行目录或临时目录内，目标越界: {}",
                target.display()
            ))
        }
        "danger-full-access" => Ok(()),
        _ => Err(format!("未知沙箱模式: {mode}")),
    }
}

/// Bound listing / grep traversal to the execution root unless full access.
fn check_read_scope(mode: &str, workspace_root: &str, target: &Path) -> Result<(), String> {
    if mode == "danger-full-access" {
        return Ok(());
    }
    let root = effective_root(workspace_root)?;
    if is_within(&root, target) {
        Ok(())
    } else {
        Err(format!(
            "该沙箱模式下仅允许访问执行目录内: {}",
            target.display()
        ))
    }
}

fn relative_display(root: &str, path: &Path) -> String {
    let root = effective_root(root).unwrap_or_else(|_| normalize_lexical(Path::new(root)));
    path.strip_prefix(&root)
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| path.display().to_string())
}

#[tauri::command]
pub fn fs_read(req: FsReadRequest) -> Result<FsReadResponse, String> {
    validate_mode(&req.sandbox_mode)?;
    let target = resolve(&req.workspace_root, &req.path)?;
    let meta = fs::metadata(&target).map_err(|e| format!("读取文件信息失败: {e}"))?;
    if meta.is_dir() {
        return Err(format!("目标是目录，请使用 ls: {}", target.display()));
    }
    let raw = fs::read(&target).map_err(|e| format!("读取文件失败: {e}"))?;
    let text = String::from_utf8_lossy(&raw).to_string();

    let all_lines: Vec<&str> = text.split('\n').collect();
    let total_lines = all_lines.len();
    let start = req.offset.unwrap_or(1).max(1) - 1;
    let slice: Vec<&str> = if let Some(limit) = req.limit {
        all_lines.iter().skip(start).take(limit).copied().collect()
    } else if start > 0 {
        all_lines.iter().skip(start).copied().collect()
    } else {
        all_lines.clone()
    };
    let mut content = slice.join("\n");

    let mut truncated = false;
    if content.len() > MAX_READ_BYTES {
        let mut end = MAX_READ_BYTES;
        while end > 0 && !content.is_char_boundary(end) {
            end -= 1;
        }
        content.truncate(end);
        truncated = true;
    }

    Ok(FsReadResponse {
        path: target.display().to_string(),
        content,
        truncated,
        line_count: total_lines,
    })
}

#[tauri::command]
pub fn fs_write(req: FsWriteRequest) -> Result<FsWriteResponse, String> {
    validate_mode(&req.sandbox_mode)?;
    let target = resolve(&req.workspace_root, &req.path)?;
    check_write(&req.sandbox_mode, &req.workspace_root, &target)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {e}"))?;
    }
    fs::write(&target, req.content.as_bytes()).map_err(|e| format!("写入文件失败: {e}"))?;
    Ok(FsWriteResponse {
        path: target.display().to_string(),
        bytes_written: req.content.len(),
    })
}

#[tauri::command]
pub fn fs_edit(req: FsEditRequest) -> Result<FsEditResponse, String> {
    validate_mode(&req.sandbox_mode)?;
    if req.old_str.is_empty() {
        return Err("oldStr 不能为空".to_string());
    }
    let target = resolve(&req.workspace_root, &req.path)?;
    check_write(&req.sandbox_mode, &req.workspace_root, &target)?;

    let original = fs::read_to_string(&target).map_err(|e| format!("读取文件失败: {e}"))?;
    let occurrences = original.matches(&req.old_str).count();
    if occurrences == 0 {
        return Err("未找到匹配的 oldStr".to_string());
    }
    let replace_all = req.replace_all.unwrap_or(false);
    if !replace_all && occurrences > 1 {
        return Err(format!(
            "oldStr 匹配到 {occurrences} 处，请提供更精确的内容或设置 replaceAll"
        ));
    }
    let updated = if replace_all {
        original.replace(&req.old_str, &req.new_str)
    } else {
        original.replacen(&req.old_str, &req.new_str, 1)
    };
    fs::write(&target, updated.as_bytes()).map_err(|e| format!("写入文件失败: {e}"))?;
    Ok(FsEditResponse {
        path: target.display().to_string(),
        replaced: if replace_all { occurrences } else { 1 },
    })
}

#[tauri::command]
pub fn fs_list(req: FsListRequest) -> Result<FsListResponse, String> {
    validate_mode(&req.sandbox_mode)?;
    let raw_path = req.path.clone().unwrap_or_else(|| ".".to_string());
    let target = resolve(&req.workspace_root, &raw_path)?;
    check_read_scope(&req.sandbox_mode, &req.workspace_root, &target)?;

    let read_dir = fs::read_dir(&target).map_err(|e| format!("读取目录失败: {e}"))?;
    let mut entries: Vec<FsListEntry> = Vec::new();
    for item in read_dir {
        let item = item.map_err(|e| format!("枚举目录项失败: {e}"))?;
        let name = item.file_name().to_string_lossy().to_string();
        let file_type = item
            .file_type()
            .map_err(|e| format!("读取项类型失败: {e}"))?;
        let kind = if file_type.is_dir() {
            "dir"
        } else if file_type.is_symlink() {
            "symlink"
        } else {
            "file"
        };
        let size = item.metadata().map(|m| m.len()).unwrap_or(0);
        entries.push(FsListEntry {
            name,
            kind: kind.to_string(),
            size,
        });
    }
    entries.sort_by(|a, b| match (a.kind == "dir", b.kind == "dir") {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(FsListResponse {
        path: target.display().to_string(),
        entries,
    })
}

#[tauri::command]
pub fn fs_grep(req: FsGrepRequest) -> Result<FsGrepResponse, String> {
    validate_mode(&req.sandbox_mode)?;
    if req.pattern.trim().is_empty() {
        return Err("缺少匹配模式".to_string());
    }
    let raw_path = req.path.clone().unwrap_or_else(|| ".".to_string());
    let root = resolve(&req.workspace_root, &raw_path)?;
    check_read_scope(&req.sandbox_mode, &req.workspace_root, &root)?;

    let regex = RegexBuilder::new(&req.pattern)
        .case_insensitive(req.ignore_case.unwrap_or(false))
        .build()
        .map_err(|e| format!("无效的正则: {e}"))?;
    let limit = req.max_results.unwrap_or(DEFAULT_GREP_LIMIT).max(1);

    let mut matches: Vec<FsGrepMatch> = Vec::new();
    let mut truncated = false;

    if root.is_file() {
        grep_file(
            &root,
            &regex,
            &req.workspace_root,
            limit,
            &mut matches,
            &mut truncated,
        );
        return Ok(FsGrepResponse { matches, truncated });
    }

    let mut stack: Vec<PathBuf> = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        if matches.len() >= limit {
            truncated = true;
            break;
        }
        let Ok(read_dir) = fs::read_dir(&dir) else {
            continue;
        };
        for item in read_dir.flatten() {
            let path = item.path();
            let Ok(file_type) = item.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                let name = item.file_name().to_string_lossy().to_string();
                if SKIP_DIRS.contains(&name.as_str()) {
                    continue;
                }
                stack.push(path);
            } else if file_type.is_file() {
                grep_file(
                    &path,
                    &regex,
                    &req.workspace_root,
                    limit,
                    &mut matches,
                    &mut truncated,
                );
                if matches.len() >= limit {
                    truncated = true;
                    break;
                }
            }
        }
    }

    Ok(FsGrepResponse { matches, truncated })
}

fn grep_file(
    path: &Path,
    regex: &regex::Regex,
    root: &str,
    limit: usize,
    matches: &mut Vec<FsGrepMatch>,
    truncated: &mut bool,
) {
    if let Ok(meta) = fs::metadata(path) {
        if meta.len() > MAX_GREP_FILE_BYTES {
            return;
        }
    }
    let Ok(bytes) = fs::read(path) else {
        return;
    };
    // Skip likely-binary files (NUL byte in the first chunk).
    if bytes.iter().take(8000).any(|b| *b == 0) {
        return;
    }
    let text = String::from_utf8_lossy(&bytes);
    for (idx, line) in text.lines().enumerate() {
        if matches.len() >= limit {
            *truncated = true;
            return;
        }
        if regex.is_match(line) {
            let trimmed: String = line.chars().take(400).collect();
            matches.push(FsGrepMatch {
                path: relative_display(root, path),
                line: idx + 1,
                text: trimmed,
            });
        }
    }
}
