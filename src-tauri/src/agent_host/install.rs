//! Isolated environment provisioning for external agent packages.
//!
//! Builds a per-package isolated runtime so custom agents are zero-config:
//! - Python: `uv venv <pkg>/.venv` then `uv pip install` (editable project or
//!   requirements), returning the venv path.
//! - Node: `pnpm install` in the package dir, returning the package dir (its
//!   `node_modules` is the isolated env).
//!
//! Build output is streamed to the frontend as `agent://install/<taskId>` line
//! events so the UI can show progress; the command resolves when the toolchain
//! process exits.

use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildEnvSpec {
    /// `"python"` or `"node"`.
    runtime: String,
    /// Absolute agent package directory.
    package_dir: String,
    /// Optional explicit `uv` binary path (falls back to `uv` on PATH).
    #[serde(default)]
    uv_bin: Option<String>,
    /// Optional explicit `pnpm` binary path (falls back to `pnpm` on PATH).
    #[serde(default)]
    pnpm_bin: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildEnvResult {
    ok: bool,
    /// Path to the isolated env root (venv dir for python; package dir for node).
    env_path: String,
    exit_code: Option<i32>,
}

#[derive(Clone, Serialize)]
struct InstallLine {
    task_id: String,
    stream: String,
    line: String,
}

fn emit_line(app: &AppHandle, task_id: &str, stream: &str, line: &str) {
    let _ = app.emit(
        &format!("agent://install/{task_id}"),
        InstallLine {
            task_id: task_id.to_string(),
            stream: stream.to_string(),
            line: line.to_string(),
        },
    );
}

/// Run a command, streaming stdout+stderr lines to the frontend. Returns the
/// process exit code (or `None` if it was killed).
fn run_streamed(
    app: &AppHandle,
    task_id: &str,
    program: &str,
    args: &[String],
    cwd: &Path,
) -> Result<Option<i32>, String> {
    emit_line(app, task_id, "info", &format!("$ {program} {}", args.join(" ")));
    let mut child = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法执行 {program}：{e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let mut handles = Vec::new();
    if let Some(out) = stdout {
        let app = app.clone();
        let task_id = task_id.to_string();
        handles.push(thread::spawn(move || {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                emit_line(&app, &task_id, "stdout", line.trim_end());
            }
        }));
    }
    if let Some(err) = stderr {
        let app = app.clone();
        let task_id = task_id.to_string();
        handles.push(thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                emit_line(&app, &task_id, "stderr", line.trim_end());
            }
        }));
    }

    let status = child.wait().map_err(|e| format!("等待进程失败：{e}"))?;
    for h in handles {
        let _ = h.join();
    }
    Ok(status.code())
}

#[tauri::command]
pub async fn agent_build_env(
    app: AppHandle,
    task_id: String,
    spec: BuildEnvSpec,
) -> Result<BuildEnvResult, String> {
    let pkg = Path::new(&spec.package_dir);
    if !pkg.is_dir() {
        return Err(format!("包目录不存在：{}", spec.package_dir));
    }

    match spec.runtime.as_str() {
        "python" => {
            let uv = spec.uv_bin.clone().unwrap_or_else(|| "uv".to_string());
            let venv = pkg.join(".venv");
            let venv_str = venv.to_string_lossy().to_string();

            let code = run_streamed(
                &app,
                &task_id,
                &uv,
                &["venv".to_string(), venv_str.clone()],
                pkg,
            )?;
            if code != Some(0) {
                return Ok(BuildEnvResult { ok: false, env_path: venv_str, exit_code: code });
            }

            // Prefer an editable project install; fall back to requirements.txt.
            let install_args: Vec<String> = if pkg.join("pyproject.toml").is_file() {
                vec![
                    "pip".into(),
                    "install".into(),
                    "--python".into(),
                    venv_str.clone(),
                    "-e".into(),
                    ".".into(),
                ]
            } else if pkg.join("requirements.txt").is_file() {
                vec![
                    "pip".into(),
                    "install".into(),
                    "--python".into(),
                    venv_str.clone(),
                    "-r".into(),
                    "requirements.txt".into(),
                ]
            } else {
                emit_line(&app, &task_id, "info", "无 pyproject.toml / requirements.txt，跳过依赖安装");
                return Ok(BuildEnvResult { ok: true, env_path: venv_str, exit_code: Some(0) });
            };

            let code = run_streamed(&app, &task_id, &uv, &install_args, pkg)?;
            Ok(BuildEnvResult {
                ok: code == Some(0),
                env_path: venv_str,
                exit_code: code,
            })
        }
        "node" => {
            let pnpm = spec.pnpm_bin.clone().unwrap_or_else(|| "pnpm".to_string());
            let code = run_streamed(
                &app,
                &task_id,
                &pnpm,
                &["install".to_string()],
                pkg,
            )?;
            Ok(BuildEnvResult {
                ok: code == Some(0),
                env_path: spec.package_dir.clone(),
                exit_code: code,
            })
        }
        other => Err(format!("unsupported runtime: {other}")),
    }
}
