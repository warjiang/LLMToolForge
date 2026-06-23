use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use wait_timeout::ChildExt;

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
        .invoke_handler(tauri::generate_handler![run_sandboxed_command])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
