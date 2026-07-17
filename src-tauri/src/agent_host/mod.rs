//! Agent host: supervise external agent subprocesses (Python / Node) that speak
//! the Agent Adapter Protocol (AAP) over stdio.
//!
//! Responsibilities:
//! - `agent_spawn`: launch a child process with piped stdin/stdout/stderr,
//!   injecting the Unified gateway base URL + local key via env. A reader thread
//!   parses `@@AAP@@`-prefixed stdout lines and re-emits them to the frontend as
//!   `agent://event/<runId>` Tauri events; other stdout/stderr lines are logged.
//! - `agent_send`: write a single JSON line (init / prompt / abort) to the
//!   child's stdin.
//! - `agent_kill`: terminate the child and drop its handle.
//!
//! Model access is intentionally *not* mediated here: the child talks to the
//! local Unified gateway directly (OpenAI/Anthropic compatible), so the host
//! only shuttles AAP control/events.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

pub mod install;

/// Stdout line prefix marking a structured agent → host event.
const AAP_MARKER: &str = "@@AAP@@";

/// One supervised agent subprocess.
struct AgentRun {
    child: Child,
    stdin: Option<ChildStdin>,
}

#[derive(Default)]
pub struct AgentHost {
    runs: Arc<Mutex<HashMap<String, AgentRun>>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSpawnSpec {
    /// Program to execute (absolute path or resolvable name), e.g. the venv's
    /// python or a node binary.
    program: String,
    #[serde(default)]
    args: Vec<String>,
    /// Working directory for the child (the agent package dir).
    #[serde(default)]
    cwd: Option<String>,
    /// Extra environment variables (Unified base URL / local key, etc.).
    #[serde(default)]
    env: HashMap<String, String>,
}

/// Payload emitted to the frontend for each AAP event line.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentEventPayload {
    run_id: String,
    event: Value,
}

fn event_name(run_id: &str) -> String {
    format!("agent://event/{run_id}")
}

/// Emit a synthetic AAP event (used for spawn/exit failures) to the frontend.
fn emit_synthetic(app: &AppHandle, run_id: &str, event: Value) {
    let _ = app.emit(
        &event_name(run_id),
        AgentEventPayload {
            run_id: run_id.to_string(),
            event,
        },
    );
}

#[tauri::command]
pub async fn agent_spawn(
    app: AppHandle,
    host: tauri::State<'_, AgentHost>,
    run_id: String,
    spec: AgentSpawnSpec,
) -> Result<(), String> {
    {
        let runs = host.runs.lock().map_err(|_| "agent host poisoned")?;
        if runs.contains_key(&run_id) {
            return Err(format!("run {run_id} already exists"));
        }
    }

    let mut cmd = Command::new(&spec.program);
    cmd.args(&spec.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::proc_env::apply_to_command(&mut cmd);
    if let Some(cwd) = &spec.cwd {
        if !cwd.trim().is_empty() {
            cmd.current_dir(cwd);
        }
    }
    for (k, v) in &spec.env {
        cmd.env(k, v);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动 agent 进程失败：{e}"))?;

    let stdin = child.stdin.take();
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法捕获 agent stdout".to_string())?;
    let stderr = child.stderr.take();

    // Reader thread: parse AAP marker lines → frontend events; forward the rest.
    {
        let app = app.clone();
        let run_id = run_id.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                let trimmed = line.trim_end();
                if let Some(rest) = trimmed.trim_start().strip_prefix(AAP_MARKER) {
                    match serde_json::from_str::<Value>(rest.trim()) {
                        Ok(event) if event.get("type").is_some() => {
                            let _ = app.emit(
                                &event_name(&run_id),
                                AgentEventPayload {
                                    run_id: run_id.clone(),
                                    event,
                                },
                            );
                        }
                        _ => eprintln!("[agent {run_id}] malformed AAP line: {trimmed}"),
                    }
                } else if !trimmed.is_empty() {
                    eprintln!("[agent {run_id}] {trimmed}");
                }
            }
        });
    }

    // Diagnostics: drain stderr to the host console.
    if let Some(stderr) = stderr {
        let run_id = run_id.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                let line = line.trim_end();
                if !line.is_empty() {
                    eprintln!("[agent {run_id}][stderr] {line}");
                }
            }
        });
    }

    // Watcher thread: when the process exits, notify the frontend and drop it.
    {
        let app = app.clone();
        let run_id = run_id.clone();
        let runs = host.runs.clone();
        thread::spawn(move || loop {
            let done = {
                let mut guard = match runs.lock() {
                    Ok(g) => g,
                    Err(_) => break,
                };
                match guard.get_mut(&run_id) {
                    Some(run) => match run.child.try_wait() {
                        Ok(Some(_status)) => true,
                        Ok(None) => false,
                        Err(_) => true,
                    },
                    None => break, // killed/removed elsewhere
                }
            };
            if done {
                if let Ok(mut guard) = runs.lock() {
                    guard.remove(&run_id);
                }
                emit_synthetic(&app, &run_id, serde_json::json!({ "type": "exit" }));
                break;
            }
            thread::sleep(std::time::Duration::from_millis(200));
        });
    }

    let mut runs = host.runs.lock().map_err(|_| "agent host poisoned")?;
    runs.insert(run_id, AgentRun { child, stdin });
    Ok(())
}

#[tauri::command]
pub async fn agent_send(
    host: tauri::State<'_, AgentHost>,
    run_id: String,
    line: String,
) -> Result<(), String> {
    let mut runs = host.runs.lock().map_err(|_| "agent host poisoned")?;
    let run = runs
        .get_mut(&run_id)
        .ok_or_else(|| format!("run {run_id} not found"))?;
    let stdin = run
        .stdin
        .as_mut()
        .ok_or_else(|| "agent stdin unavailable".to_string())?;
    stdin
        .write_all(line.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|e| format!("写入 agent stdin 失败：{e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn agent_kill(host: tauri::State<'_, AgentHost>, run_id: String) -> Result<(), String> {
    let mut runs = host.runs.lock().map_err(|_| "agent host poisoned")?;
    if let Some(mut run) = runs.remove(&run_id) {
        // Dropping stdin signals EOF; then hard-kill to be safe.
        run.stdin.take();
        let _ = run.child.kill();
        let _ = run.child.wait();
    }
    Ok(())
}
