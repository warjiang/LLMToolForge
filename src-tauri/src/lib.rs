use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use tauri::Manager;
use wait_timeout::ChildExt;

mod browser;
mod data_tools;
mod fs_tools;
mod mcp;
mod unified;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SandboxRunRequest {
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    sandbox_mode: String,
    timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SandboxRunResponse {
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    timed_out: bool,
    duration_ms: u128,
    sandbox_backend: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveChatAttachmentRequest {
    workspace_root: String,
    attachment_id: String,
    file_name: String,
    data_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveChatAttachmentResponse {
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncSkillsRequest {
    mode: String,
    skills: Vec<SyncSkillPayload>,
    targets: Vec<SyncTargetPayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncSkillPayload {
    id: String,
    name: String,
    description: String,
    tags: Vec<String>,
    content: Option<String>,
    enabled: bool,
    #[serde(default)]
    files: Vec<SkillFilePayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillFilePayload {
    path: String,
    content: String,
    encoding: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncTargetPayload {
    agent_key: String,
    agent_name: String,
    scope: String,
    target_dir: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncSkillResult {
    skill_id: String,
    skill_name: String,
    agent_key: String,
    agent_name: String,
    scope: String,
    target_path: String,
    status: String,
    error: Option<String>,
}

#[tauri::command]
fn run_sandboxed_command(req: SandboxRunRequest) -> Result<SandboxRunResponse, String> {
    if req.command.trim().is_empty() {
        return Err("缺少命令".to_string());
    }
    if !matches!(
        req.sandbox_mode.as_str(),
        "read-only" | "workspace-write" | "danger-full-access"
    ) {
        return Err(format!("未知沙箱模式: {}", req.sandbox_mode));
    }

    let timeout = Duration::from_millis(req.timeout_ms.unwrap_or(30_000).clamp(1_000, 120_000));
    let started = Instant::now();
    // Fall back to a managed sandbox directory when no workspace path is set,
    // so command execution works even before the user picks a workspace.
    let cwd_path = match req.cwd.as_deref().map(str::trim) {
        Some(c) if !c.is_empty() && c != "." => PathBuf::from(c),
        _ => default_sandbox_dir()?,
    };
    let cwd = cwd_path
        .canonicalize()
        .unwrap_or(cwd_path)
        .display()
        .to_string();
    let temp_dir = sandbox_temp_dir()?;
    let temp_dir_str = temp_dir.display().to_string();
    let mut command = build_platform_command(&req, &cwd, &temp_dir_str)?;
    command.current_dir(&cwd);
    command.env_clear();
    command.env("PATH", std::env::var("PATH").unwrap_or_default());
    command.env("HOME", std::env::var("HOME").unwrap_or_default());
    command.env("TMPDIR", &temp_dir_str);
    command.env("TMP", &temp_dir_str);
    command.env("TEMP", &temp_dir_str);
    command.env("LLMTOOLFORGE_SANDBOX_MODE", &req.sandbox_mode);
    if let Some(env) = req.env.as_ref() {
        for (key, value) in env {
            if is_safe_env_key(key) {
                command.env(key, value);
            }
        }
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|e| format!("启动命令失败: {e}"))?;
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let stdout_handle = thread::spawn(move || read_pipe(stdout.take()));
    let stderr_handle = thread::spawn(move || read_pipe(stderr.take()));

    let (exit_code, timed_out) = match child
        .wait_timeout(timeout)
        .map_err(|e| format!("等待命令失败: {e}"))?
    {
        Some(status) => (status.code(), false),
        None => {
            let _ = child.kill();
            let _ = child.wait();
            (None, true)
        }
    };

    let stdout = stdout_handle
        .join()
        .unwrap_or_else(|_| Err("读取 stdout 失败".to_string()))?;
    let stderr = stderr_handle
        .join()
        .unwrap_or_else(|_| Err("读取 stderr 失败".to_string()))?;

    Ok(SandboxRunResponse {
        stdout,
        stderr,
        exit_code,
        timed_out,
        duration_ms: started.elapsed().as_millis(),
        sandbox_backend: sandbox_backend(&req.sandbox_mode).to_string(),
    })
}

#[tauri::command]
fn save_chat_attachment(
    req: SaveChatAttachmentRequest,
) -> Result<SaveChatAttachmentResponse, String> {
    let root = execution_root(&req.workspace_root)?;
    fs::create_dir_all(&root).map_err(|e| format!("创建执行目录失败: {e}"))?;

    let file_name = sanitize_file_name(&req.file_name);
    let path = unique_attachment_path(&root, &file_name, &req.attachment_id);
    let bytes = bytes_from_data_url(&req.data_url)?;
    fs::write(&path, bytes).map_err(|e| format!("写入附件失败: {e}"))?;
    Ok(SaveChatAttachmentResponse {
        path: path.display().to_string(),
    })
}

#[tauri::command]
fn sync_skills_to_targets(
    app: tauri::AppHandle,
    request: SyncSkillsRequest,
) -> Result<Vec<SyncSkillResult>, String> {
    if !matches!(request.mode.as_str(), "copy" | "symlink") {
        return Err(format!("未知同步模式: {}", request.mode));
    }

    let mut results = Vec::new();
    for skill in &request.skills {
        for target in &request.targets {
            let target_path = expand_home(&target.target_dir).join(skill_dir_name(skill));
            let sync = sync_one_skill(&app, skill, &target_path, &request.mode);
            results.push(SyncSkillResult {
                skill_id: skill.id.clone(),
                skill_name: skill.name.clone(),
                agent_key: target.agent_key.clone(),
                agent_name: target.agent_name.clone(),
                scope: target.scope.clone(),
                target_path: target_path.display().to_string(),
                status: if sync.is_ok() { "success" } else { "error" }.to_string(),
                error: sync.err(),
            });
        }
    }
    Ok(results)
}

#[derive(Serialize)]
struct BinStatus {
    name: String,
    found: bool,
    path: Option<String>,
}

/// Check whether each named executable is resolvable on the user's PATH. Used
/// to surface a skill's declared external requirements (`metadata.requires`)
/// without ever installing anything.
#[tauri::command]
fn check_skill_bins(bins: Vec<String>) -> Vec<BinStatus> {
    bins.into_iter()
        .map(|name| {
            let path = which_bin(&name);
            BinStatus {
                found: path.is_some(),
                path,
                name,
            }
        })
        .collect()
}

/// Minimal cross-platform `which`: scans PATH (honoring Windows PATHEXT) for an
/// executable file matching `name`. Names containing a path separator are
/// checked directly.
fn which_bin(name: &str) -> Option<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return None;
    }

    let exts: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".EXE;.CMD;.BAT;.COM".to_string())
            .split(';')
            .map(|s| s.to_string())
            .collect()
    } else {
        vec![String::new()]
    };

    if trimmed.contains('/') || trimmed.contains('\\') {
        let direct = expand_home(trimmed);
        for ext in &exts {
            let candidate = if ext.is_empty() {
                direct.clone()
            } else {
                direct.with_extension(ext.trim_start_matches('.'))
            };
            if candidate.is_file() {
                return Some(candidate.display().to_string());
            }
        }
        return None;
    }

    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        for ext in &exts {
            let candidate = dir.join(format!("{trimmed}{ext}"));
            if candidate.is_file() {
                return Some(candidate.display().to_string());
            }
        }
    }
    None
}

fn sync_one_skill(
    app: &tauri::AppHandle,
    skill: &SyncSkillPayload,
    target_path: &Path,
    mode: &str,
) -> Result<(), String> {
    if skill.name.trim().is_empty() {
        return Err("Skill 名称不能为空".to_string());
    }
    if !skill.enabled {
        return Err("Skill 已禁用，未同步".to_string());
    }

    if mode == "symlink" {
        let source = source_skill_dir(app, skill)?;
        write_skill_dir(&source, skill, true)?;
        replace_with_symlink(&source, target_path)?;
        return Ok(());
    }

    write_skill_dir(target_path, skill, false)
}

fn source_skill_dir(app: &tauri::AppHandle, skill: &SyncSkillPayload) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("获取应用配置目录失败: {e}"))?;
    dir.push("skill-sync-library");
    dir.push(skill_dir_name(skill));
    Ok(dir)
}

/// Managed working directory used by the sandbox when no workspace is selected.
pub(crate) fn default_sandbox_dir() -> Result<PathBuf, String> {
    let mut dir = std::env::temp_dir();
    dir.push("LLMToolForge");
    dir.push("agent-sandbox");
    fs::create_dir_all(&dir).map_err(|e| format!("创建沙箱目录失败: {e}"))?;
    Ok(dir.canonicalize().unwrap_or(dir))
}

fn sandbox_temp_dir() -> Result<PathBuf, String> {
    let mut dir = default_sandbox_dir()?;
    dir.push("tmp");
    fs::create_dir_all(&dir).map_err(|e| format!("创建沙箱临时目录失败: {e}"))?;
    Ok(dir.canonicalize().unwrap_or(dir))
}

fn execution_root(workspace_root: &str) -> Result<PathBuf, String> {
    if workspace_root.trim().is_empty() {
        default_sandbox_dir()
    } else {
        Ok(PathBuf::from(workspace_root.trim()))
    }
}

/// Replaces characters unsafe for a directory name so a session id maps to a
/// single, predictable folder.
fn sanitize_session_id(id: &str) -> String {
    id.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// Per-session managed workspace under the user's home, used when no explicit
/// workspace path is set: `~/.llmtoolforge/sessions/<session id>`.
fn session_workspace_dir(app: &tauri::AppHandle, session_id: &str) -> Result<PathBuf, String> {
    let safe = sanitize_session_id(session_id);
    if safe.is_empty() {
        return Err("无效的会话 ID".to_string());
    }
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("无法定位用户主目录: {e}"))?;
    let mut dir = home;
    dir.push(".llmtoolforge");
    dir.push("sessions");
    dir.push(safe);
    Ok(dir)
}

/// Resolves and creates the execution root for a chat session, returning its
/// absolute path. Falls back to a per-session directory under the user's home
/// when no explicit workspace path was provided.
#[tauri::command]
fn ensure_session_workspace(
    app: tauri::AppHandle,
    session_id: String,
    workspace_path: Option<String>,
) -> Result<String, String> {
    let explicit = workspace_path.as_deref().map(str::trim).unwrap_or("");
    let dir = if explicit.is_empty() {
        session_workspace_dir(&app, &session_id)?
    } else {
        PathBuf::from(explicit)
    };
    fs::create_dir_all(&dir).map_err(|e| format!("创建会话工作目录失败: {e}"))?;
    Ok(dir.canonicalize().unwrap_or(dir).display().to_string())
}

fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches([' ', '.']).trim();
    if trimmed.is_empty() {
        "attachment".to_string()
    } else {
        trimmed.to_string()
    }
}

fn unique_attachment_path(root: &Path, file_name: &str, attachment_id: &str) -> PathBuf {
    let candidate = root.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("attachment");
    let ext = path.extension().and_then(|s| s.to_str());
    let suffix: String = attachment_id.chars().take(8).collect();
    let unique_name = match ext {
        Some(ext) if !ext.is_empty() => format!("{stem}-{suffix}.{ext}"),
        _ => format!("{stem}-{suffix}"),
    };
    root.join(unique_name)
}

fn bytes_from_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let Some((header, payload)) = data_url.split_once(',') else {
        return Err("附件内容不是 data URL".to_string());
    };
    if !header.starts_with("data:") || !header.contains(";base64") {
        return Err("仅支持 base64 data URL 附件".to_string());
    }
    decode_base64(payload).ok_or_else(|| "附件 base64 解码失败".to_string())
}

fn write_skill_dir(dir: &Path, skill: &SyncSkillPayload, replace_dir: bool) -> Result<(), String> {
    if replace_dir {
        remove_existing(dir)?;
    } else {
        remove_file_or_symlink(dir)?;
    }
    fs::create_dir_all(dir).map_err(|e| format!("创建 Skill 目录失败: {e}"))?;

    if !skill.files.is_empty() {
        return write_skill_files(dir, skill);
    }

    fs::write(dir.join("SKILL.md"), skill_document(skill))
        .map_err(|e| format!("写入 SKILL.md 失败: {e}"))?;
    Ok(())
}

/// Write a multi-file skill verbatim, guarding against path traversal.
fn write_skill_files(dir: &Path, skill: &SyncSkillPayload) -> Result<(), String> {
    let mut wrote_skill_md = false;
    for file in &skill.files {
        let rel = sanitize_rel_path(&file.path)
            .ok_or_else(|| format!("非法的文件路径: {}", file.path))?;
        let dest = dir.join(&rel);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
        }
        let bytes = match file.encoding.as_str() {
            "utf8" => file.content.clone().into_bytes(),
            "base64" => decode_base64(&file.content)
                .ok_or_else(|| format!("base64 解码失败: {}", file.path))?,
            other => return Err(format!("未知文件编码: {other}")),
        };
        fs::write(&dest, bytes).map_err(|e| format!("写入文件失败 {}: {e}", file.path))?;
        if rel.to_string_lossy().eq_ignore_ascii_case("SKILL.md") {
            wrote_skill_md = true;
        }
    }
    if !wrote_skill_md {
        fs::write(dir.join("SKILL.md"), skill_document(skill))
            .map_err(|e| format!("写入 SKILL.md 失败: {e}"))?;
    }
    Ok(())
}

/// Normalize a skill-relative path, rejecting absolute paths and `..` escapes.
fn sanitize_rel_path(input: &str) -> Option<PathBuf> {
    let normalized = input.replace('\\', "/");
    if normalized.is_empty() {
        return None;
    }
    let mut out = PathBuf::new();
    let mut depth = 0i32;
    for segment in normalized.split('/') {
        match segment {
            "" | "." => continue,
            ".." => {
                depth -= 1;
                if depth < 0 {
                    return None;
                }
                out.pop();
            }
            _ => {
                if segment.contains(':') || segment.starts_with('~') {
                    return None;
                }
                depth += 1;
                out.push(segment);
            }
        }
    }
    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Minimal, dependency-free standard base64 decoder.
fn decode_base64(input: &str) -> Option<Vec<u8>> {
    fn val(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let mut out = Vec::new();
    let mut buf = 0u32;
    let mut bits = 0u32;
    for &c in input.as_bytes() {
        if c == b'=' || c.is_ascii_whitespace() {
            continue;
        }
        let v = val(c)? as u32;
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Some(out)
}

fn replace_with_symlink(source: &Path, target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目标目录失败: {e}"))?;
    }
    remove_existing(target)?;
    create_dir_symlink(source, target).map_err(|e| format!("创建软链失败: {e}"))
}

#[cfg(unix)]
fn create_dir_symlink(source: &Path, target: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(source, target)
}

#[cfg(windows)]
fn create_dir_symlink(source: &Path, target: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_dir(source, target)
}

fn remove_existing(path: &Path) -> Result<(), String> {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return Ok(());
    };
    if meta.file_type().is_symlink() || meta.is_file() {
        fs::remove_file(path).map_err(|e| format!("删除已有文件失败: {e}"))?;
    } else if meta.is_dir() {
        fs::remove_dir_all(path).map_err(|e| format!("删除已有目录失败: {e}"))?;
    }
    Ok(())
}

fn remove_file_or_symlink(path: &Path) -> Result<(), String> {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return Ok(());
    };
    if meta.file_type().is_symlink() || meta.is_file() {
        fs::remove_file(path).map_err(|e| format!("删除已有文件失败: {e}"))?;
    }
    Ok(())
}

fn skill_document(skill: &SyncSkillPayload) -> String {
    let description = if skill.description.trim().is_empty() {
        format!("Skill {}", skill.name.trim())
    } else {
        skill.description.trim().to_string()
    };

    let raw = skill
        .content
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    // Market/GitHub skills carry the raw SKILL.md (frontmatter included) in
    // `content`. Strip the leading frontmatter so we don't emit a duplicate
    // block, while preserving any other keys (e.g. `metadata.requires`) the
    // app doesn't manage itself.
    let (extra_frontmatter, body) = match raw {
        Some(content) => match split_frontmatter(content) {
            Some((frontmatter, inner_body)) => {
                let inner_body = inner_body.trim();
                let body = if inner_body.is_empty() {
                    description.clone()
                } else {
                    inner_body.to_string()
                };
                (strip_managed_frontmatter_keys(frontmatter), body)
            }
            None => (String::new(), content.to_string()),
        },
        None => (String::new(), description.clone()),
    };

    let tags = if skill.tags.is_empty() {
        String::new()
    } else {
        let tags = skill
            .tags
            .iter()
            .map(|tag| format!("\"{}\"", yaml_line(tag)))
            .collect::<Vec<_>>()
            .join(", ");
        format!("tags: [{}]\n", tags)
    };

    let mut extra = extra_frontmatter;
    if !extra.is_empty() && !extra.ends_with('\n') {
        extra.push('\n');
    }

    format!(
        "---\nname: \"{}\"\ndescription: \"{}\"\n{}{}---\n\n{}\n",
        yaml_line(skill.name.trim()),
        yaml_line(&description),
        tags,
        extra,
        body
    )
}

/// Splits a leading YAML frontmatter block from `content`.
///
/// Returns `(frontmatter_inner, body)` when `content` starts with a `---`
/// delimited block, otherwise `None`.
fn split_frontmatter(content: &str) -> Option<(&str, &str)> {
    let rest = content.strip_prefix("---")?;
    let rest = rest
        .strip_prefix('\n')
        .or_else(|| rest.strip_prefix("\r\n"))?;

    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim_end_matches(['\n', '\r']) == "---" {
            let frontmatter = &rest[..offset];
            let body = &rest[offset + line.len()..];
            return Some((frontmatter, body));
        }
        offset += line.len();
    }
    None
}

/// Drops the top-level `name`, `description`, and `tags` keys (and any nested
/// child lines) from a frontmatter block; the app regenerates these itself.
fn strip_managed_frontmatter_keys(frontmatter: &str) -> String {
    const MANAGED: [&str; 3] = ["name:", "description:", "tags:"];
    let mut out = String::new();
    let mut skipping_block = false;
    for line in frontmatter.lines() {
        let is_top_level = !line.is_empty() && !line.starts_with([' ', '\t']);
        if is_top_level {
            let trimmed = line.trim_start();
            if MANAGED.iter().any(|key| trimmed.starts_with(key)) {
                skipping_block = true;
                continue;
            }
            skipping_block = false;
        } else if skipping_block {
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}

fn yaml_line(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace(['\n', '\r'], " ")
}

fn skill_dir_name(skill: &SyncSkillPayload) -> String {
    let slug = slugify(&skill.name);
    let short_id: String = skill
        .id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect();
    if short_id.is_empty() {
        slug
    } else {
        format!("{slug}-{short_id}")
    }
}

fn slugify(value: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in value.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "skill".to_string()
    } else {
        trimmed
    }
}

fn expand_home(path: &str) -> PathBuf {
    if path == "~" {
        return home_dir();
    }
    if let Some(rest) = path.strip_prefix("~/") {
        return home_dir().join(rest);
    }
    PathBuf::from(path)
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn read_pipe(pipe: Option<impl Read>) -> Result<String, String> {
    let Some(mut pipe) = pipe else {
        return Ok(String::new());
    };
    let mut bytes = Vec::new();
    pipe.read_to_end(&mut bytes)
        .map_err(|e| format!("读取命令输出失败: {e}"))?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

fn is_safe_env_key(key: &str) -> bool {
    key.chars()
        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
        && !key.contains("KEY")
        && !key.contains("SECRET")
        && !key.contains("TOKEN")
        && !key.contains("PASSWORD")
}

fn sandbox_backend(mode: &str) -> &'static str {
    if mode == "danger-full-access" {
        "none"
    } else if cfg!(target_os = "macos") {
        "seatbelt-compatible"
    } else {
        "process-boundary"
    }
}

fn build_platform_command(
    req: &SandboxRunRequest,
    _cwd: &str,
    _temp_dir: &str,
) -> Result<Command, String> {
    #[cfg(target_os = "macos")]
    {
        if req.sandbox_mode != "danger-full-access" {
            let mut command = Command::new("sandbox-exec");
            command
                .arg("-p")
                .arg(seatbelt_profile(&req.sandbox_mode, _cwd, _temp_dir));
            command.arg(&req.command).args(&req.args);
            return Ok(command);
        }
    }

    let mut command = Command::new(&req.command);
    command.args(&req.args);
    Ok(command)
}

#[cfg(target_os = "macos")]
fn seatbelt_profile(mode: &str, cwd: &str, temp_dir: &str) -> String {
    let mut profile = String::from("(version 1)\n(allow default)\n");
    if mode == "read-only" {
        profile.push_str("(deny file-write*)\n");
        profile.push_str(&format!(
            "(allow file-write* (subpath \"{}\"))\n",
            escape_seatbelt_path(temp_dir)
        ));
        profile.push_str("(allow file-write* (subpath \"/tmp\"))\n");
        profile.push_str("(allow file-write* (subpath \"/private/tmp\"))\n");
    } else if mode == "workspace-write" {
        profile.push_str("(deny file-write*)\n");
        profile.push_str(&format!(
            "(allow file-write* (subpath \"{}\"))\n",
            escape_seatbelt_path(cwd)
        ));
        profile.push_str(&format!(
            "(allow file-write* (subpath \"{}\"))\n",
            escape_seatbelt_path(temp_dir)
        ));
        profile.push_str("(allow file-write* (subpath \"/tmp\"))\n");
        profile.push_str("(allow file-write* (subpath \"/private/tmp\"))\n");
    }
    profile
}

#[cfg(target_os = "macos")]
fn escape_seatbelt_path(path: &str) -> String {
    path.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(unified::UnifiedManager::default())
        .manage(mcp::McpSessions::default())
        .manage(browser::BrowserState::default())
        .invoke_handler(tauri::generate_handler![
            run_sandboxed_command,
            save_chat_attachment,
            ensure_session_workspace,
            sync_skills_to_targets,
            check_skill_bins,
            fs_tools::fs_read,
            fs_tools::fs_write,
            fs_tools::fs_edit,
            fs_tools::fs_list,
            fs_tools::fs_grep,
            data_tools::duckdb_query,
            data_tools::data_chart_html,
            data_tools::data_report_html,
            unified::unified_api_set_config,
            unified::unified_api_start,
            unified::unified_api_stop,
            unified::unified_api_status,
            unified::unified_api_logs,
            unified::unified_api_clear_logs,
            unified::unified_api_stats,
            mcp::mcp_inspect,
            mcp::mcp_call_tool,
            mcp::mcp_read_resource,
            mcp::mcp_get_prompt,
            browser::browser_open,
            browser::browser_navigate,
            browser::browser_back,
            browser::browser_forward,
            browser::browser_reload,
            browser::browser_set_bounds,
            browser::browser_show,
            browser::browser_hide,
            browser::browser_close,
            browser::browser_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod skill_document_tests {
    use super::*;

    fn payload(content: &str, tags: Vec<String>) -> SyncSkillPayload {
        SyncSkillPayload {
            id: "abc123".into(),
            name: "Lark Doc".into(),
            description: "Read Lark docs".into(),
            tags,
            content: Some(content.into()),
            enabled: true,
            files: Vec::new(),
        }
    }

    #[test]
    fn single_frontmatter_no_duplication() {
        let content = "---\nname: lark-doc\ndescription: old desc\nmetadata:\n  requires:\n    bins:\n      - lark-cli\n---\n\n# Body\nhello";
        let doc = skill_document(&payload(content, vec![]));
        assert_eq!(
            doc.matches("---").count(),
            2,
            "exactly one frontmatter block"
        );
        assert!(doc.contains("name: \"Lark Doc\""));
        assert!(doc.contains("description: \"Read Lark docs\""));
        assert!(!doc.contains("old desc"));
        assert!(doc.contains("requires:"));
        assert!(doc.contains("- lark-cli"));
        assert!(doc.contains("# Body\nhello"));
    }

    #[test]
    fn managed_tags_block_is_replaced() {
        let content = "---\nname: x\ntags:\n  - old1\n  - old2\nmetadata:\n  foo: bar\n---\nbody";
        let doc = skill_document(&payload(content, vec!["new1".into()]));
        assert!(doc.contains("tags: [\"new1\"]"));
        assert!(!doc.contains("old1"));
        assert!(!doc.contains("old2"));
        assert!(doc.contains("foo: bar"));
        assert_eq!(doc.matches("---").count(), 2);
    }

    #[test]
    fn plain_content_without_frontmatter() {
        let doc = skill_document(&payload("just some text", vec![]));
        assert_eq!(doc.matches("---").count(), 2);
        assert!(doc.ends_with("just some text\n"));
        assert!(doc.contains("name: \"Lark Doc\""));
    }
}
