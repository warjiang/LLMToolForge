use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Instant;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use command_group::{AsyncCommandGroup, AsyncGroupChild};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, oneshot};

const FRAME_START: &str = "\u{1e}LTF:";
const FRAME_END: char = '\u{1f}';
const MAX_SOURCE_BYTES: usize = 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct ShellNotebookError {
    pub code: String,
    pub message: String,
}

impl ShellNotebookError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

type ShellResult<T> = Result<T, ShellNotebookError>;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellNotebookConfig {
    pub start_directory: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellNotebookSessionInfo {
    pub session_id: String,
    pub current_directory: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ShellNotebookEvent {
    Ready {
        session_id: String,
        current_directory: String,
    },
    RunStarted {
        run_id: String,
        started_at: u128,
    },
    Output {
        run_id: String,
        stream: String,
        chunk: String,
    },
    RunFinished {
        run_id: String,
        exit_code: i32,
        duration_ms: u128,
        truncated: bool,
        current_directory: String,
    },
    RunCancelled {
        run_id: String,
        state_reset: bool,
    },
    SessionTerminated {
        run_id: Option<String>,
        reason: String,
    },
    Error {
        code: String,
        message: String,
        run_id: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CompletionFrame {
    run_id: String,
    exit_code: i32,
    current_directory_b64: String,
}

/// Separates internal completion records from user output without depending on
/// arbitrary pipe read boundaries. `take_visible` returns only user output.
struct CompletionFrameParser {
    token: String,
    buffer: String,
    visible: String,
}

impl CompletionFrameParser {
    fn new(token: impl Into<String>) -> Self {
        Self {
            token: token.into(),
            buffer: String::new(),
            visible: String::new(),
        }
    }

    fn push(&mut self, chunk: &str) -> Vec<CompletionFrame> {
        self.buffer.push_str(chunk);
        let marker = format!("{FRAME_START}{}:", self.token);
        let mut frames = Vec::new();

        loop {
            let Some(start) = self.buffer.find(&marker) else {
                let retain = longest_prefix_suffix(&self.buffer, &marker);
                let split = self.buffer.len() - retain;
                self.visible.push_str(&self.buffer[..split]);
                self.buffer = self.buffer[split..].to_string();
                break;
            };

            self.visible.push_str(&self.buffer[..start]);
            let after_marker = start + marker.len();
            let Some(end_offset) = self.buffer[after_marker..].find(FRAME_END) else {
                self.buffer = self.buffer[start..].to_string();
                break;
            };
            let end = after_marker + end_offset;
            let payload = &self.buffer[after_marker..end];
            let mut fields = payload.splitn(3, ':');
            let run_id = fields.next();
            let exit_code = fields.next().and_then(|value| value.parse::<i32>().ok());
            let current_directory_b64 = fields.next();
            if let (Some(run_id), Some(exit_code), Some(current_directory_b64)) =
                (run_id, exit_code, current_directory_b64)
            {
                frames.push(CompletionFrame {
                    run_id: run_id.to_string(),
                    exit_code,
                    current_directory_b64: current_directory_b64.to_string(),
                });
            }
            self.buffer = self.buffer[end + FRAME_END.len_utf8()..].to_string();
        }

        frames
    }

    fn take_visible(&mut self) -> String {
        std::mem::take(&mut self.visible)
    }
}

fn longest_prefix_suffix(value: &str, prefix: &str) -> usize {
    let max = value.len().min(prefix.len().saturating_sub(1));
    for length in (1..=max).rev() {
        if value.ends_with(&prefix[..length]) {
            return length;
        }
    }
    0
}

pub struct ShellNotebookManager {
    sessions: Mutex<HashMap<String, mpsc::UnboundedSender<SessionCommand>>>,
}

impl Default for ShellNotebookManager {
    fn default() -> Self {
        cleanup_stale_temp_directories();
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

impl ShellNotebookManager {
    fn insert(&self, id: String, sender: mpsc::UnboundedSender<SessionCommand>) {
        self.sessions
            .lock()
            .expect("shell session lock poisoned")
            .insert(id, sender);
    }

    fn get(&self, id: &str) -> Option<mpsc::UnboundedSender<SessionCommand>> {
        self.sessions
            .lock()
            .expect("shell session lock poisoned")
            .get(id)
            .cloned()
    }

    fn take(&self, id: &str) -> Option<mpsc::UnboundedSender<SessionCommand>> {
        self.sessions
            .lock()
            .expect("shell session lock poisoned")
            .remove(id)
    }

    pub fn shutdown(&self) {
        let sessions =
            std::mem::take(&mut *self.sessions.lock().expect("shell session lock poisoned"));
        for (_, sender) in sessions {
            let _ = sender.send(SessionCommand::Close { respond_to: None });
        }
    }
}

fn cleanup_stale_temp_directories() {
    let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if name.starts_with("ltf-shellnb-") && path.is_dir() {
            let _ = std::fs::remove_dir_all(path);
        }
    }
}

enum SessionCommand {
    Execute {
        run_id: String,
        source: String,
        respond_to: oneshot::Sender<ShellResult<()>>,
    },
    Stop {
        respond_to: oneshot::Sender<ShellResult<ShellNotebookSessionInfo>>,
    },
    Restart {
        config: ShellNotebookConfig,
        respond_to: oneshot::Sender<ShellResult<ShellNotebookSessionInfo>>,
    },
    Close {
        respond_to: Option<oneshot::Sender<()>>,
    },
}

enum ReaderMessage {
    Output {
        generation: u64,
        stream: &'static str,
        chunk: String,
        frames: Vec<CompletionFrame>,
    },
    Closed {
        generation: u64,
        stream: &'static str,
    },
}

struct SessionProcess {
    child: AsyncGroupChild,
    stdin: tokio::process::ChildStdin,
    generation: u64,
    temp_directory: PathBuf,
    start_directory: PathBuf,
}

struct ActiveRun {
    run_id: String,
    started_at: Instant,
    stdout_frame: Option<CompletionFrame>,
    stderr_frame: Option<CompletionFrame>,
    output_bytes: usize,
    truncated: bool,
    script_path: PathBuf,
}

fn new_session_id() -> String {
    format!("shell-notebook-{:032x}", rand::random::<u128>())
}

fn normalize_start_directory(value: &str) -> ShellResult<PathBuf> {
    let path = if value.trim().is_empty() {
        dirs::home_dir().ok_or_else(|| {
            ShellNotebookError::new("invalid_working_directory", "could not resolve $HOME")
        })?
    } else {
        PathBuf::from(value)
    };
    if !path.is_dir() {
        return Err(ShellNotebookError::new(
            "invalid_working_directory",
            format!("not a directory: {}", path.display()),
        ));
    }
    Ok(path.canonicalize().unwrap_or(path))
}

fn shell_quote(value: &Path) -> String {
    let value = value.to_string_lossy();
    format!("'{}'", value.replace('\'', "'\\''"))
}

async fn spawn_process(
    session_id: &str,
    start_directory: PathBuf,
    token: String,
    generation: u64,
    reader_sender: mpsc::UnboundedSender<ReaderMessage>,
) -> ShellResult<SessionProcess> {
    let temp_directory =
        std::env::temp_dir().join(format!("ltf-shellnb-{session_id}-{generation}"));
    tokio::fs::create_dir_all(&temp_directory)
        .await
        .map_err(|error| ShellNotebookError::new("spawn_failed", error.to_string()))?;

    let mut command = tokio::process::Command::new("bash");
    command
        .args(["--norc", "--noprofile"])
        .current_dir(&start_directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::proc_env::apply_to_tokio_command(&mut command);
    let mut child = command.group_spawn().map_err(|error| {
        let code = if error.kind() == std::io::ErrorKind::NotFound {
            "bash_not_found"
        } else {
            "spawn_failed"
        };
        ShellNotebookError::new(code, error.to_string())
    })?;

    let mut stdin = child
        .inner()
        .stdin
        .take()
        .ok_or_else(|| ShellNotebookError::new("spawn_failed", "bash stdin unavailable"))?;
    let stdout = child
        .inner()
        .stdout
        .take()
        .ok_or_else(|| ShellNotebookError::new("spawn_failed", "bash stdout unavailable"))?;
    let stderr = child
        .inner()
        .stderr
        .take()
        .ok_or_else(|| ShellNotebookError::new("spawn_failed", "bash stderr unavailable"))?;

    spawn_reader(
        stdout,
        generation,
        "stdout",
        token.clone(),
        reader_sender.clone(),
    );
    spawn_reader(stderr, generation, "stderr", token, reader_sender);
    stdin
        .write_all(b"shopt -s expand_aliases\n")
        .await
        .map_err(|error| ShellNotebookError::new("stdin_write_failed", error.to_string()))?;
    stdin
        .flush()
        .await
        .map_err(|error| ShellNotebookError::new("stdin_write_failed", error.to_string()))?;
    Ok(SessionProcess {
        child,
        stdin,
        generation,
        temp_directory,
        start_directory,
    })
}

fn spawn_reader(
    mut reader: impl tokio::io::AsyncRead + Unpin + Send + 'static,
    generation: u64,
    stream: &'static str,
    token: String,
    sender: mpsc::UnboundedSender<ReaderMessage>,
) {
    tokio::spawn(async move {
        let mut parser = CompletionFrameParser::new(token);
        let mut bytes = [0_u8; 8192];
        loop {
            match reader.read(&mut bytes).await {
                Ok(0) => {
                    let pending = parser.take_visible();
                    if !pending.is_empty() {
                        let _ = sender.send(ReaderMessage::Output {
                            generation,
                            stream,
                            chunk: pending,
                            frames: Vec::new(),
                        });
                    }
                    let _ = sender.send(ReaderMessage::Closed { generation, stream });
                    break;
                }
                Ok(read) => {
                    let frames = parser.push(&String::from_utf8_lossy(&bytes[..read]));
                    let chunk = parser.take_visible();
                    if !chunk.is_empty() || !frames.is_empty() {
                        let _ = sender.send(ReaderMessage::Output {
                            generation,
                            stream,
                            chunk,
                            frames,
                        });
                    }
                }
                Err(_) => {
                    let _ = sender.send(ReaderMessage::Closed { generation, stream });
                    break;
                }
            }
        }
    });
}

fn completion_current_directory(frame: &CompletionFrame) -> ShellResult<String> {
    let bytes = B64.decode(&frame.current_directory_b64).map_err(|error| {
        ShellNotebookError::new(
            "protocol_lost",
            format!("invalid completion directory: {error}"),
        )
    })?;
    String::from_utf8(bytes)
        .map_err(|error| ShellNotebookError::new("protocol_lost", error.to_string()))
}

fn run_wrapper(token: &str, run_id: &str, script_path: &Path) -> String {
    let script = shell_quote(script_path);
    format!(
        "source {script}\n\
__ltf_exit=$?\n\
LTF_LAST_EXIT_CODE=$__ltf_exit\n\
__ltf_dir_b64=$(pwd | tr -d '\\n' | base64 | tr -d '\\n')\n\
printf '\\036LTF:{token}:{run_id}:%s:%s\\037' \"$__ltf_exit\" \"$__ltf_dir_b64\"\n\
printf '\\036LTF:{token}:{run_id}:%s:%s\\037' \"$__ltf_exit\" \"$__ltf_dir_b64\" >&2\n\
(exit \"$__ltf_exit\")\n"
    )
}

fn is_safe_run_id(run_id: &str) -> bool {
    !run_id.is_empty()
        && run_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

async fn write_script(
    process: &SessionProcess,
    run_id: &str,
    source: &str,
) -> ShellResult<PathBuf> {
    let path = process.temp_directory.join(format!(
        "ltf-shellnb-{run_id}-{:032x}.sh",
        rand::random::<u128>()
    ));
    tokio::fs::write(&path, source)
        .await
        .map_err(|error| ShellNotebookError::new("stdin_write_failed", error.to_string()))?;
    Ok(path)
}

async fn run_session_actor(
    session_id: String,
    token: String,
    config: ShellNotebookConfig,
    on_event: Channel<ShellNotebookEvent>,
    ready: oneshot::Sender<ShellResult<ShellNotebookSessionInfo>>,
    mut commands: mpsc::UnboundedReceiver<SessionCommand>,
    reader_sender: mpsc::UnboundedSender<ReaderMessage>,
    mut reader_messages: mpsc::UnboundedReceiver<ReaderMessage>,
) {
    let initial_directory = match normalize_start_directory(&config.start_directory) {
        Ok(directory) => directory,
        Err(error) => {
            let _ = ready.send(Err(error.clone()));
            let _ = on_event.send(ShellNotebookEvent::Error {
                code: error.code,
                message: error.message,
                run_id: None,
            });
            return;
        }
    };
    let mut process = match spawn_process(
        &session_id,
        initial_directory,
        token.clone(),
        1,
        reader_sender.clone(),
    )
    .await
    {
        Ok(process) => process,
        Err(error) => {
            let _ = ready.send(Err(error.clone()));
            let _ = on_event.send(ShellNotebookEvent::Error {
                code: error.code,
                message: error.message,
                run_id: None,
            });
            return;
        }
    };
    let mut current_directory = process.start_directory.display().to_string();
    let _ = on_event.send(ShellNotebookEvent::Ready {
        session_id: session_id.clone(),
        current_directory: current_directory.clone(),
    });
    let _ = ready.send(Ok(ShellNotebookSessionInfo {
        session_id: session_id.clone(),
        current_directory: current_directory.clone(),
    }));
    let mut active: Option<ActiveRun> = None;
    let mut session_lost = false;

    loop {
        let command = tokio::select! {
            command = commands.recv() => match command {
                Some(command) => command,
                None => break,
            },
            message = reader_messages.recv() => {
                if let Some(message) = message {
                    handle_reader_message(
                        message,
                        &mut active,
                        &mut current_directory,
                        &mut session_lost,
                        process.generation,
                        &on_event,
                    ).await;
                    if session_lost {
                        let _ = process.child.kill().await;
                        let _ = tokio::fs::remove_dir_all(&process.temp_directory).await;
                    }
                }
                continue;
            }
        };
        match command {
            SessionCommand::Execute {
                run_id,
                source,
                respond_to,
            } => {
                if session_lost {
                    let _ = respond_to.send(Err(ShellNotebookError::new(
                        "session_terminated",
                        "the shell session has terminated",
                    )));
                    continue;
                }
                if active.is_some() {
                    let _ = respond_to.send(Err(ShellNotebookError::new(
                        "session_busy",
                        "a shell notebook cell is already running",
                    )));
                    continue;
                }
                if source.len() > MAX_SOURCE_BYTES {
                    let _ = respond_to.send(Err(ShellNotebookError::new(
                        "source_too_large",
                        "cell source exceeds 1 MiB",
                    )));
                    continue;
                }
                if !is_safe_run_id(&run_id) {
                    let _ = respond_to.send(Err(ShellNotebookError::new(
                        "protocol_lost",
                        "run id must contain only letters, digits, hyphens, and underscores",
                    )));
                    continue;
                }
                let script_path = match write_script(&process, &run_id, &source).await {
                    Ok(path) => path,
                    Err(error) => {
                        let _ = respond_to.send(Err(error));
                        continue;
                    }
                };
                let wrapper = run_wrapper(&token, &run_id, &script_path);
                if let Err(error) = process.stdin.write_all(wrapper.as_bytes()).await {
                    let _ = tokio::fs::remove_file(&script_path).await;
                    let _ = respond_to.send(Err(ShellNotebookError::new(
                        "stdin_write_failed",
                        error.to_string(),
                    )));
                    continue;
                }
                if let Err(error) = process.stdin.flush().await {
                    let _ = tokio::fs::remove_file(&script_path).await;
                    let _ = respond_to.send(Err(ShellNotebookError::new(
                        "stdin_write_failed",
                        error.to_string(),
                    )));
                    continue;
                }
                let _ = on_event.send(ShellNotebookEvent::RunStarted {
                    run_id: run_id.clone(),
                    started_at: 0,
                });
                active = Some(ActiveRun {
                    run_id,
                    started_at: Instant::now(),
                    stdout_frame: None,
                    stderr_frame: None,
                    output_bytes: 0,
                    truncated: false,
                    script_path,
                });
                let _ = respond_to.send(Ok(()));
            }
            SessionCommand::Stop { respond_to } => {
                if let Some(active_run) = active.take() {
                    let _ = tokio::fs::remove_file(&active_run.script_path).await;
                    let _ = on_event.send(ShellNotebookEvent::RunCancelled {
                        run_id: active_run.run_id,
                        state_reset: true,
                    });
                }
                let _ = process.child.kill().await;
                let _ = tokio::fs::remove_dir_all(&process.temp_directory).await;
                let next_generation = process.generation + 1;
                match spawn_process(
                    &session_id,
                    process.start_directory.clone(),
                    token.clone(),
                    next_generation,
                    reader_sender.clone(),
                )
                .await
                {
                    Ok(next) => {
                        process = next;
                        current_directory = process.start_directory.display().to_string();
                        session_lost = false;
                        let info = ShellNotebookSessionInfo {
                            session_id: session_id.clone(),
                            current_directory: current_directory.clone(),
                        };
                        let _ = on_event.send(ShellNotebookEvent::Ready {
                            session_id: session_id.clone(),
                            current_directory: current_directory.clone(),
                        });
                        let _ = respond_to.send(Ok(info));
                    }
                    Err(error) => {
                        session_lost = true;
                        let _ = respond_to.send(Err(error));
                    }
                }
            }
            SessionCommand::Restart { config, respond_to } => {
                let directory = match normalize_start_directory(&config.start_directory) {
                    Ok(directory) => directory,
                    Err(error) => {
                        let _ = respond_to.send(Err(error));
                        continue;
                    }
                };
                if let Some(active_run) = active.take() {
                    let _ = tokio::fs::remove_file(&active_run.script_path).await;
                }
                let _ = process.child.kill().await;
                let _ = tokio::fs::remove_dir_all(&process.temp_directory).await;
                match spawn_process(
                    &session_id,
                    directory,
                    token.clone(),
                    process.generation + 1,
                    reader_sender.clone(),
                )
                .await
                {
                    Ok(next) => {
                        process = next;
                        current_directory = process.start_directory.display().to_string();
                        session_lost = false;
                        let info = ShellNotebookSessionInfo {
                            session_id: session_id.clone(),
                            current_directory: current_directory.clone(),
                        };
                        let _ = on_event.send(ShellNotebookEvent::Ready {
                            session_id: session_id.clone(),
                            current_directory: current_directory.clone(),
                        });
                        let _ = respond_to.send(Ok(info));
                    }
                    Err(error) => {
                        session_lost = true;
                        let _ = respond_to.send(Err(error));
                    }
                }
            }
            SessionCommand::Close { respond_to } => {
                if let Some(active_run) = active.take() {
                    let _ = tokio::fs::remove_file(active_run.script_path).await;
                }
                let _ = process.child.kill().await;
                let _ = tokio::fs::remove_dir_all(&process.temp_directory).await;
                if let Some(respond_to) = respond_to {
                    let _ = respond_to.send(());
                }
                break;
            }
        }
    }
}

async fn handle_reader_message(
    message: ReaderMessage,
    active: &mut Option<ActiveRun>,
    current_directory: &mut String,
    session_lost: &mut bool,
    generation: u64,
    on_event: &Channel<ShellNotebookEvent>,
) {
    match message {
        ReaderMessage::Output {
            generation: message_generation,
            stream,
            chunk,
            frames,
        } if message_generation == generation => {
            let Some(active_run) = active.as_mut() else {
                return;
            };
            if !chunk.is_empty() {
                let remaining = MAX_OUTPUT_BYTES.saturating_sub(active_run.output_bytes);
                if remaining > 0 {
                    let byte_end = chunk
                        .char_indices()
                        .take_while(|(index, character)| index + character.len_utf8() <= remaining)
                        .last()
                        .map(|(index, character)| index + character.len_utf8())
                        .unwrap_or(0);
                    if byte_end > 0 {
                        active_run.output_bytes += byte_end;
                        let _ = on_event.send(ShellNotebookEvent::Output {
                            run_id: active_run.run_id.clone(),
                            stream: stream.to_string(),
                            chunk: chunk[..byte_end].to_string(),
                        });
                    }
                    if byte_end < chunk.len() {
                        active_run.truncated = true;
                    }
                } else {
                    active_run.truncated = true;
                }
            }
            for frame in frames {
                if frame.run_id != active_run.run_id {
                    continue;
                }
                if stream == "stdout" {
                    active_run.stdout_frame = Some(frame);
                } else {
                    active_run.stderr_frame = Some(frame);
                }
            }
            let complete = active_run.stdout_frame.is_some() && active_run.stderr_frame.is_some();
            if complete {
                let finished = active.take().expect("active run checked above");
                let frame = finished.stdout_frame.expect("stdout completion checked");
                match completion_current_directory(&frame) {
                    Ok(directory) => {
                        *current_directory = directory.clone();
                        let _ = on_event.send(ShellNotebookEvent::RunFinished {
                            run_id: finished.run_id,
                            exit_code: frame.exit_code,
                            duration_ms: finished.started_at.elapsed().as_millis(),
                            truncated: finished.truncated,
                            current_directory: directory,
                        });
                        let _ = tokio::fs::remove_file(finished.script_path).await;
                    }
                    Err(error) => {
                        *session_lost = true;
                        let _ = tokio::fs::remove_file(finished.script_path).await;
                        let _ = on_event.send(ShellNotebookEvent::SessionTerminated {
                            run_id: Some(finished.run_id.clone()),
                            reason: error.message.clone(),
                        });
                        let _ = on_event.send(ShellNotebookEvent::Error {
                            code: error.code,
                            message: error.message,
                            run_id: Some(finished.run_id),
                        });
                    }
                }
            }
        }
        ReaderMessage::Closed {
            generation: message_generation,
            stream: _stream,
        } if message_generation == generation => {
            if !*session_lost {
                *session_lost = true;
                let run_id = active.as_ref().map(|run| run.run_id.clone());
                if let Some(finished) = active.take() {
                    let _ = tokio::fs::remove_file(&finished.script_path).await;
                }
                let _ = on_event.send(ShellNotebookEvent::SessionTerminated {
                    run_id,
                    reason: "bash exited".to_string(),
                });
            }
        }
        _ => {}
    }
}

#[tauri::command]
pub async fn shell_notebook_open(
    manager: tauri::State<'_, ShellNotebookManager>,
    config: ShellNotebookConfig,
    on_event: Channel<ShellNotebookEvent>,
) -> ShellResult<ShellNotebookSessionInfo> {
    let start_directory = normalize_start_directory(&config.start_directory)?;
    let session_id = new_session_id();
    let (sender, receiver) = mpsc::unbounded_channel();
    let (reader_sender, reader_receiver) = mpsc::unbounded_channel();
    let (ready_sender, ready_receiver) = oneshot::channel();
    manager.insert(session_id.clone(), sender);
    let actor_session_id = session_id.clone();
    tokio::spawn(run_session_actor(
        actor_session_id,
        format!("{:032x}", rand::random::<u128>()),
        ShellNotebookConfig {
            start_directory: start_directory.display().to_string(),
        },
        on_event,
        ready_sender,
        receiver,
        reader_sender,
        reader_receiver,
    ));
    match ready_receiver.await {
        Ok(Ok(info)) => Ok(info),
        Ok(Err(error)) => {
            manager.take(&session_id);
            Err(error)
        }
        Err(_) => {
            manager.take(&session_id);
            Err(ShellNotebookError::new(
                "spawn_failed",
                "shell session actor exited during startup",
            ))
        }
    }
}

#[tauri::command]
pub async fn shell_notebook_execute(
    manager: tauri::State<'_, ShellNotebookManager>,
    session_id: String,
    run_id: String,
    source: String,
) -> ShellResult<()> {
    let sender = manager
        .get(&session_id)
        .ok_or_else(|| ShellNotebookError::new("session_not_found", "no such shell session"))?;
    let (response_sender, response_receiver) = oneshot::channel();
    sender
        .send(SessionCommand::Execute {
            run_id,
            source,
            respond_to: response_sender,
        })
        .map_err(|_| ShellNotebookError::new("session_terminated", "shell session is closed"))?;
    response_receiver
        .await
        .map_err(|_| ShellNotebookError::new("session_terminated", "shell session is closed"))?
}

#[tauri::command]
pub async fn shell_notebook_stop(
    manager: tauri::State<'_, ShellNotebookManager>,
    session_id: String,
) -> ShellResult<ShellNotebookSessionInfo> {
    let sender = manager
        .get(&session_id)
        .ok_or_else(|| ShellNotebookError::new("session_not_found", "no such shell session"))?;
    let (response_sender, response_receiver) = oneshot::channel();
    sender
        .send(SessionCommand::Stop {
            respond_to: response_sender,
        })
        .map_err(|_| ShellNotebookError::new("session_terminated", "shell session is closed"))?;
    response_receiver
        .await
        .map_err(|_| ShellNotebookError::new("session_terminated", "shell session is closed"))?
}

#[tauri::command]
pub async fn shell_notebook_restart(
    manager: tauri::State<'_, ShellNotebookManager>,
    session_id: String,
    config: ShellNotebookConfig,
) -> ShellResult<ShellNotebookSessionInfo> {
    let sender = manager
        .get(&session_id)
        .ok_or_else(|| ShellNotebookError::new("session_not_found", "no such shell session"))?;
    let (response_sender, response_receiver) = oneshot::channel();
    sender
        .send(SessionCommand::Restart {
            config,
            respond_to: response_sender,
        })
        .map_err(|_| ShellNotebookError::new("session_terminated", "shell session is closed"))?;
    response_receiver
        .await
        .map_err(|_| ShellNotebookError::new("session_terminated", "shell session is closed"))?
}

#[tauri::command]
pub async fn shell_notebook_close(
    manager: tauri::State<'_, ShellNotebookManager>,
    session_id: String,
) -> ShellResult<()> {
    let sender = manager
        .take(&session_id)
        .ok_or_else(|| ShellNotebookError::new("session_not_found", "no such shell session"))?;
    let (response_sender, response_receiver) = oneshot::channel();
    sender
        .send(SessionCommand::Close {
            respond_to: Some(response_sender),
        })
        .map_err(|_| ShellNotebookError::new("session_terminated", "shell session is closed"))?;
    let _ = response_receiver.await;
    Ok(())
}

#[tauri::command]
pub fn shell_notebook_export_markdown(path: String, contents: String) -> ShellResult<()> {
    std::fs::write(path, contents)
        .map_err(|error| ShellNotebookError::new("export_failed", error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::{
        completion_current_directory, run_wrapper, spawn_process, write_script, CompletionFrame,
        CompletionFrameParser, ReaderMessage, ShellNotebookError, FRAME_END, FRAME_START,
    };
    use std::time::Duration;
    use tokio::io::AsyncWriteExt;
    use tokio::sync::mpsc;

    #[test]
    fn serializes_stable_structured_errors() {
        let value = serde_json::to_value(ShellNotebookError::new(
            "session_busy",
            "a cell is already running",
        ))
        .expect("error should serialize");

        assert_eq!(value["code"], "session_busy");
        assert_eq!(value["message"], "a cell is already running");
    }

    #[test]
    fn parses_completion_frames_across_arbitrary_chunks() {
        let mut parser = CompletionFrameParser::new("token");
        assert!(parser
            .push("before\u{1e}LTF:token:run-1:0:L3RtcC9w")
            .is_empty());
        let frames = parser.push("cm9qZWN0\u{1f}after");

        assert_eq!(
            frames,
            vec![CompletionFrame {
                run_id: "run-1".into(),
                exit_code: 0,
                current_directory_b64: "L3RtcC9wcm9qZWN0".into(),
            }]
        );
        assert_eq!(parser.take_visible(), "beforeafter");
    }

    #[test]
    fn preserves_a_partial_frame_prefix_until_the_next_chunk() {
        let mut parser = CompletionFrameParser::new("token");
        let marker = format!("{FRAME_START}token:");
        let prefix = &marker[..marker.len() - 2];
        assert!(parser.push(&format!("hello{prefix}")).is_empty());
        assert_eq!(parser.take_visible(), "hello");

        let frames = parser.push(&format!(
            "{}run:0:L2hvbWU={FRAME_END}",
            &marker[marker.len() - 2..]
        ));
        assert_eq!(frames.len(), 1);
    }

    #[tokio::test]
    async fn preserves_variables_functions_aliases_and_current_directory_between_runs() {
        let start_directory = std::env::temp_dir();
        let token = "test-token".to_string();
        let (reader_sender, mut reader_messages) = mpsc::unbounded_channel();
        let mut process = spawn_process(
            "integration",
            start_directory.clone(),
            token.clone(),
            1,
            reader_sender,
        )
        .await
        .expect("bash should start");

        let first = execute_for_test(
            &mut process,
            &token,
            "run-one",
            "shell_value=green\nshell_function() { printf '%s' \"$shell_value\"; }\nalias shell_alias='shell_function'\ncd /tmp\n",
            &mut reader_messages,
        )
        .await;
        assert_eq!(first.exit_code, 0);

        let second = execute_for_test(
            &mut process,
            &token,
            "run-two",
            "shell_alias\nprintf '\\n%s' \"$PWD\"\n",
            &mut reader_messages,
        )
        .await;

        assert_eq!(second.exit_code, 0);
        assert_eq!(second.stdout, "green\n/tmp");
        assert_eq!(second.current_directory, "/tmp");

        let _ = process.child.kill().await;
        let _ = tokio::fs::remove_dir_all(process.temp_directory).await;
    }

    #[tokio::test]
    async fn exits_the_session_when_errexit_is_enabled_and_the_next_cell_fails() {
        let (reader_sender, mut reader_messages) = mpsc::unbounded_channel();
        let mut process = spawn_process(
            "errexit",
            std::env::temp_dir(),
            "test-token".to_string(),
            1,
            reader_sender,
        )
        .await
        .expect("bash should start");

        let configured = execute_for_test(
            &mut process,
            "test-token",
            "run-errexit",
            "set -e\n",
            &mut reader_messages,
        )
        .await;
        assert_eq!(configured.exit_code, 0);

        let script_path = write_script(&process, "run-fail", "false\n")
            .await
            .expect("script should write");
        process
            .stdin
            .write_all(run_wrapper("test-token", "run-fail", &script_path).as_bytes())
            .await
            .expect("wrapper should write");
        process.stdin.flush().await.expect("stdin should flush");

        let mut closed = false;
        while !closed {
            let message = tokio::time::timeout(Duration::from_secs(5), reader_messages.recv())
                .await
                .expect("bash should exit")
                .expect("reader should send closure");
            if matches!(message, ReaderMessage::Closed { .. }) {
                closed = true;
            }
        }
        let _ = tokio::fs::remove_file(script_path).await;
        let _ = process.child.kill().await;
        let _ = tokio::fs::remove_dir_all(process.temp_directory).await;
    }

    struct TestRun {
        exit_code: i32,
        stdout: String,
        current_directory: String,
    }

    async fn execute_for_test(
        process: &mut super::SessionProcess,
        token: &str,
        run_id: &str,
        source: &str,
        reader_messages: &mut mpsc::UnboundedReceiver<ReaderMessage>,
    ) -> TestRun {
        let script_path = write_script(process, run_id, source)
            .await
            .expect("script should write");
        process
            .stdin
            .write_all(run_wrapper(token, run_id, &script_path).as_bytes())
            .await
            .expect("wrapper should write");
        process.stdin.flush().await.expect("stdin should flush");

        let mut stdout = String::new();
        let mut stdout_frame = None;
        let mut stderr_frame = None;
        while stdout_frame.is_none() || stderr_frame.is_none() {
            let message = tokio::time::timeout(Duration::from_secs(5), reader_messages.recv())
                .await
                .expect("run should complete")
                .expect("reader should stay active");
            if let ReaderMessage::Output {
                stream,
                chunk,
                frames,
                ..
            } = message
            {
                if stream == "stdout" {
                    stdout.push_str(&chunk);
                    stdout_frame = frames.into_iter().next().or(stdout_frame);
                } else {
                    stderr_frame = frames.into_iter().next().or(stderr_frame);
                }
            }
        }
        let frame = stdout_frame.expect("stdout completion frame");
        let _ = tokio::fs::remove_file(script_path).await;
        TestRun {
            exit_code: frame.exit_code,
            stdout,
            current_directory: completion_current_directory(&frame)
                .expect("completion directory should decode"),
        }
    }
}
