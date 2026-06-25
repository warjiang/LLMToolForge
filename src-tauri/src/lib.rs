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
    let cwd = req.cwd.clone().unwrap_or_else(|| ".".to_string());
    let mut command = build_platform_command(&req, &cwd)?;
    command.current_dir(&cwd);
    command.env_clear();
    command.env("PATH", std::env::var("PATH").unwrap_or_default());
    command.env("HOME", std::env::var("HOME").unwrap_or_default());
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

fn write_skill_dir(dir: &Path, skill: &SyncSkillPayload, replace_dir: bool) -> Result<(), String> {
    if replace_dir {
        remove_existing(dir)?;
    } else {
        remove_file_or_symlink(dir)?;
    }
    fs::create_dir_all(dir).map_err(|e| format!("创建 Skill 目录失败: {e}"))?;
    fs::write(dir.join("SKILL.md"), skill_document(skill))
        .map_err(|e| format!("写入 SKILL.md 失败: {e}"))?;
    Ok(())
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
    let body = skill
        .content
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(description.as_str());
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

    format!(
        "---\nname: \"{}\"\ndescription: \"{}\"\n{}---\n\n{}\n",
        yaml_line(skill.name.trim()),
        yaml_line(&description),
        tags,
        body
    )
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

fn build_platform_command(req: &SandboxRunRequest, _cwd: &str) -> Result<Command, String> {
    #[cfg(target_os = "macos")]
    {
        if req.sandbox_mode != "danger-full-access" {
            let mut command = Command::new("sandbox-exec");
            command
                .arg("-p")
                .arg(seatbelt_profile(&req.sandbox_mode, _cwd));
            command.arg(&req.command).args(&req.args);
            return Ok(command);
        }
    }

    let mut command = Command::new(&req.command);
    command.args(&req.args);
    Ok(command)
}

#[cfg(target_os = "macos")]
fn seatbelt_profile(mode: &str, cwd: &str) -> String {
    let mut profile = String::from("(version 1)\n(allow default)\n");
    if mode == "read-only" {
        profile.push_str("(deny file-write*)\n");
    } else if mode == "workspace-write" {
        profile.push_str("(deny file-write*)\n");
        profile.push_str(&format!(
            "(allow file-write* (subpath \"{}\"))\n",
            escape_seatbelt_path(cwd)
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
        .invoke_handler(tauri::generate_handler![
            run_sandboxed_command,
            sync_skills_to_targets,
            unified::unified_api_set_config,
            unified::unified_api_start,
            unified::unified_api_stop,
            unified::unified_api_status,
            unified::unified_api_logs,
            unified::unified_api_clear_logs,
            unified::unified_api_stats,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
