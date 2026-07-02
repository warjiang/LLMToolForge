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
use tauri::{AppHandle, Emitter, Manager};

use crate::{decode_base64, sanitize_rel_path};

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
#[serde(rename_all = "camelCase")]
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

/// Verify a toolchain binary is runnable (`<program> --version`). Returns a
/// user-actionable error when it's missing so install failures are diagnosable
/// instead of surfacing an opaque spawn error mid-build.
fn check_toolchain(
    app: &AppHandle,
    task_id: &str,
    program: &str,
    install_hint: &str,
) -> Result<(), String> {
    match Command::new(program)
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
    {
        Ok(out) => {
            let ver = String::from_utf8_lossy(&out.stdout);
            let ver = ver.lines().next().unwrap_or("").trim();
            emit_line(
                app,
                task_id,
                "info",
                &format!("检测到 {program}：{ver}"),
            );
            Ok(())
        }
        Err(e) => {
            let msg = format!(
                "未找到工具链 `{program}`（{e}）。请先安装：{install_hint}"
            );
            emit_line(app, task_id, "stderr", &msg);
            Err(msg)
        }
    }
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
    emit_line(
        app,
        task_id,
        "info",
        &format!("$ {program} {}", args.join(" ")),
    );
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

/// Raw `defaults` block in an agent package manifest (`agent.json`).
#[derive(Debug, Deserialize)]
struct RawManifestDefaults {
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    temperature: Option<f64>,
    #[serde(default, rename = "maxTokens")]
    max_tokens: Option<u32>,
    #[serde(default, rename = "systemPrompt")]
    system_prompt: Option<String>,
}

/// Raw `agent.json` package manifest as authored by an agent package.
#[derive(Debug, Deserialize)]
struct RawManifest {
    id: String,
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    version: Option<String>,
    runtime: String,
    entry: String,
    #[serde(default)]
    framework: Option<String>,
    #[serde(default)]
    defaults: Option<RawManifestDefaults>,
}

/// Normalized manifest returned to the frontend (with resolved absolute dir).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentManifest {
    id: String,
    name: String,
    description: String,
    version: Option<String>,
    runtime: String,
    entry: String,
    framework: Option<String>,
    /// Absolute, canonicalized package directory.
    package_dir: String,
    default_model: Option<String>,
    default_temperature: Option<f64>,
    default_max_tokens: Option<u32>,
    default_system_prompt: Option<String>,
}

/// Read + validate an external agent package's `agent.json` manifest.
#[tauri::command]
pub async fn agent_read_manifest(package_dir: String) -> Result<AgentManifest, String> {
    let dir = Path::new(&package_dir);
    if !dir.is_dir() {
        return Err(format!("包目录不存在：{package_dir}"));
    }
    let manifest_path = dir.join("agent.json");
    let raw = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("读取 {} 失败：{e}", manifest_path.display()))?;
    let m: RawManifest =
        serde_json::from_str(&raw).map_err(|e| format!("解析 agent.json 失败：{e}"))?;

    if m.runtime != "python" && m.runtime != "node" {
        return Err(format!(
            "不支持的 runtime：{}（应为 python 或 node）",
            m.runtime
        ));
    }
    if m.entry.trim().is_empty() {
        return Err("agent.json 缺少 entry 入口文件".to_string());
    }
    if !dir.join(&m.entry).is_file() {
        return Err(format!("入口文件不存在：{}", m.entry));
    }

    let abs = dir
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or(package_dir);
    let defaults = m.defaults.unwrap_or(RawManifestDefaults {
        model: None,
        temperature: None,
        max_tokens: None,
        system_prompt: None,
    });

    Ok(AgentManifest {
        id: m.id,
        name: m.name,
        description: m.description,
        version: m.version.filter(|s| !s.trim().is_empty()),
        runtime: m.runtime,
        entry: m.entry,
        framework: m.framework.filter(|f| !f.trim().is_empty() && f != "none"),
        package_dir: abs,
        default_model: defaults.model.filter(|s| !s.trim().is_empty()),
        default_temperature: defaults.temperature,
        default_max_tokens: defaults.max_tokens,
        default_system_prompt: defaults.system_prompt.filter(|s| !s.trim().is_empty()),
    })
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
            check_toolchain(
                &app,
                &task_id,
                &uv,
                "https://docs.astral.sh/uv/getting-started/installation/",
            )?;
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
                return Ok(BuildEnvResult {
                    ok: false,
                    env_path: venv_str,
                    exit_code: code,
                });
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
                emit_line(
                    &app,
                    &task_id,
                    "info",
                    "无 pyproject.toml / requirements.txt，跳过依赖安装",
                );
                return Ok(BuildEnvResult {
                    ok: true,
                    env_path: venv_str,
                    exit_code: Some(0),
                });
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
            check_toolchain(&app, &task_id, &pnpm, "https://pnpm.io/installation")?;
            let code = run_streamed(&app, &task_id, &pnpm, &["install".to_string()], pkg)?;
            Ok(BuildEnvResult {
                ok: code == Some(0),
                env_path: spec.package_dir.clone(),
                exit_code: code,
            })
        }
        other => Err(format!("unsupported runtime: {other}")),
    }
}

/// One file in a downloaded agent package (mirrors the TS `SkillFile` shape).
#[derive(Debug, Deserialize)]
pub struct PackageFile {
    /// POSIX-relative path within the package directory.
    path: String,
    /// UTF-8 text, or base64 when `encoding` is `"base64"`.
    content: String,
    encoding: String,
}

/// Sanitize an agent package id into a safe single-segment directory name.
fn sanitize_package_id(id: &str) -> Option<String> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return None;
    }
    let cleaned: String = trimmed
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let cleaned = cleaned.trim_matches(['-', '.']).to_string();
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

/// Write a downloaded agent package (list of files) into a managed directory
/// under the app config dir (`external-agents/<id>/`), replacing any existing
/// install, and return the absolute package directory. This materializes a
/// GitHub-fetched package on disk so `agent_build_env` can provision it.
#[tauri::command]
pub async fn agent_write_package(
    app: AppHandle,
    id: String,
    files: Vec<PackageFile>,
) -> Result<String, String> {
    let safe_id =
        sanitize_package_id(&id).ok_or_else(|| format!("非法的 agent id：{id}"))?;
    if files.is_empty() {
        return Err("下载的 agent 包为空".to_string());
    }

    let mut dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("获取应用配置目录失败：{e}"))?;
    dir.push("external-agents");
    dir.push(&safe_id);

    // Replace any prior install so re-installs/updates are clean.
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("清理旧目录失败：{e}"))?;
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建 agent 目录失败：{e}"))?;

    let mut wrote_manifest = false;
    for file in &files {
        let rel = sanitize_rel_path(&file.path)
            .ok_or_else(|| format!("非法的文件路径：{}", file.path))?;
        let dest = dir.join(&rel);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
        }
        let bytes = match file.encoding.as_str() {
            "utf8" => file.content.clone().into_bytes(),
            "base64" => decode_base64(&file.content)
                .ok_or_else(|| format!("base64 解码失败：{}", file.path))?,
            other => return Err(format!("未知文件编码：{other}")),
        };
        std::fs::write(&dest, bytes)
            .map_err(|e| format!("写入文件失败 {}：{e}", file.path))?;
        if rel.to_string_lossy().eq_ignore_ascii_case("agent.json") {
            wrote_manifest = true;
        }
    }

    if !wrote_manifest {
        return Err("下载的 agent 包缺少 agent.json 清单".to_string());
    }

    let abs = dir
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| dir.to_string_lossy().to_string());
    Ok(abs)
}
