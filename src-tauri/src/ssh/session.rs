//! Interactive SSH terminal sessions backed by a pure-Rust `russh` client.
//!
//! Each `ssh_connect` performs the handshake + authentication (password or
//! private key) with credentials supplied in plaintext by the frontend (which
//! decrypts them from the vault just-in-time), opens a PTY + shell channel, and
//! spawns a task that pumps bytes between the remote shell and the frontend over
//! a Tauri IPC `Channel`. Input/resize/disconnect are delivered to that task via
//! an mpsc command queue keyed by an opaque session id.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use russh::client;
use russh::keys::ssh_key;
use russh::keys::{decode_secret_key, HashAlg, PrivateKeyWithHashAlg};
use russh::ChannelMsg;
use tauri::ipc::Channel;
use tokio::sync::mpsc;

/// Plaintext connection parameters. Secrets are decrypted by the frontend right
/// before invoking this command and never persisted in the clear.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectConfig {
    pub hostname: String,
    pub port: u16,
    pub username: String,
    /// "password" | "key" | "agent"
    pub auth_method: String,
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
    /// Ordered ProxyJump chain. The first hop is reached by a direct TCP
    /// connection; each subsequent hop (and finally the target) is tunneled
    /// through the previous one. Empty means a direct connection.
    #[serde(default)]
    pub jumps: Vec<SshHop>,
    #[serde(default)]
    pub cols: Option<u32>,
    #[serde(default)]
    pub rows: Option<u32>,
}

/// A single ProxyJump hop with its own credentials.
#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SshHop {
    pub hostname: String,
    pub port: u16,
    pub username: String,
    /// "password" | "key" | "agent"
    pub auth_method: String,
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
}

/// Bounds every TCP connect / SSH handshake step so an unreachable host (e.g. a
/// private IP that is only reachable through a jump host) surfaces a clear error
/// instead of hanging the terminal on "connecting…" forever.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectResult {
    pub session_id: String,
    pub fingerprint: Option<String>,
}

/// Events streamed to the frontend terminal over the IPC channel.
#[derive(serde::Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SshEvent {
    /// Base64-encoded bytes from the remote shell (stdout/stderr).
    Data { data: String },
    /// The remote shell exited / the channel closed.
    Closed { code: Option<u32> },
    /// A transport-level error occurred after connect.
    Error { message: String },
}

enum SessionCmd {
    Data(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

#[derive(Default)]
pub struct SshManager {
    sessions: StdMutex<HashMap<String, mpsc::UnboundedSender<SessionCmd>>>,
}

impl SshManager {
    fn insert(&self, id: String, tx: mpsc::UnboundedSender<SessionCmd>) {
        self.sessions.lock().unwrap().insert(id, tx);
    }
    fn take(&self, id: &str) -> Option<mpsc::UnboundedSender<SessionCmd>> {
        self.sessions.lock().unwrap().remove(id)
    }
    fn get(&self, id: &str) -> Option<mpsc::UnboundedSender<SessionCmd>> {
        self.sessions.lock().unwrap().get(id).cloned()
    }
}

struct ClientHandler {
    fingerprint: Arc<StdMutex<Option<String>>>,
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // Trust-on-first-use: record the fingerprint and accept. The frontend
        // surfaces it so the user can verify / pin it.
        let fp = server_public_key
            .fingerprint(ssh_key::HashAlg::Sha256)
            .to_string();
        *self.fingerprint.lock().unwrap() = Some(fp);
        Ok(true)
    }
}

fn new_session_id() -> String {
    format!("ssh-sess-{:032x}", rand::random::<u128>())
}

#[tauri::command]
pub async fn ssh_connect(
    manager: tauri::State<'_, SshManager>,
    config: SshConnectConfig,
    on_event: Channel<SshEvent>,
) -> Result<SshConnectResult, String> {
    crate::ssh::debug_log(&format!(
        "ssh_connect: ENTER {}@{}:{} ({} auth) via {} jump(s)",
        config.username,
        config.hostname,
        config.port,
        config.auth_method,
        config.jumps.len()
    ));
    let client_config = Arc::new(client::Config {
        inactivity_timeout: None,
        keepalive_interval: Some(Duration::from_secs(30)),
        // Disable Nagle's algorithm so individual keystrokes reach the remote
        // shell without buffering latency (interactive terminal use).
        nodelay: true,
        ..Default::default()
    });

    // Fingerprint of the *final* target (the host the user sees in the UI).
    let fingerprint = Arc::new(StdMutex::new(None));

    // Establish the (possibly jumped) session. `keep_alive` holds every
    // intermediate jump session so their tunnels stay open for the lifetime of
    // the terminal; `session` ends up pointing at the final target.
    let mut keep_alive: Vec<client::Handle<ClientHandler>> = Vec::new();

    // First endpoint we touch directly over TCP: the first jump, or — when there
    // are no jumps — the target itself.
    let (first_host, first_port) = match config.jumps.first() {
        Some(j) => (j.hostname.clone(), j.port),
        None => (config.hostname.clone(), config.port),
    };
    let first_is_target = config.jumps.is_empty();
    let first_handler = ClientHandler {
        fingerprint: if first_is_target {
            fingerprint.clone()
        } else {
            Arc::new(StdMutex::new(None))
        },
    };

    crate::ssh::debug_log(&format!(
        "ssh_connect: TCP connect to {first_host}:{first_port}"
    ));
    let mut session = tokio::time::timeout(
        CONNECT_TIMEOUT,
        client::connect(
            client_config.clone(),
            (first_host.as_str(), first_port),
            first_handler,
        ),
    )
    .await
    .map_err(|_| format!("connection to {first_host}:{first_port} timed out"))?
    .map_err(|e| format!("connection to {first_host}:{first_port} failed: {e}"))?;
    crate::ssh::debug_log(&format!(
        "ssh_connect: TCP connected to {first_host}:{first_port}; authenticating"
    ));

    if first_is_target {
        authenticate(&mut session, &config).await?;
    } else {
        authenticate_hop(&mut session, &config.jumps[0]).await?;
    }
    crate::ssh::debug_log(&format!(
        "ssh_connect: authenticated with {first_host}:{first_port}"
    ));

    // Tunnel through each remaining hop, then to the target.
    for idx in 0..config.jumps.len() {
        let (next_host, next_port, next_is_target) = if idx + 1 < config.jumps.len() {
            let j = &config.jumps[idx + 1];
            (j.hostname.clone(), j.port, false)
        } else {
            (config.hostname.clone(), config.port, true)
        };

        let channel = tokio::time::timeout(
            CONNECT_TIMEOUT,
            session.channel_open_direct_tcpip(next_host.clone(), next_port as u32, "127.0.0.1", 0),
        )
        .await
        .map_err(|_| format!("opening tunnel to {next_host}:{next_port} timed out"))?
        .map_err(|e| format!("ProxyJump tunnel to {next_host}:{next_port} failed: {e}"))?;

        let stream = channel.into_stream();
        let next_handler = ClientHandler {
            fingerprint: if next_is_target {
                fingerprint.clone()
            } else {
                Arc::new(StdMutex::new(None))
            },
        };
        let next_session = tokio::time::timeout(
            CONNECT_TIMEOUT,
            client::connect_stream(client_config.clone(), stream, next_handler),
        )
        .await
        .map_err(|_| format!("SSH handshake with {next_host}:{next_port} timed out"))?
        .map_err(|e| format!("connection to {next_host}:{next_port} failed: {e}"))?;

        // The previous session must outlive the tunnel running over it.
        keep_alive.push(session);
        session = next_session;

        if next_is_target {
            authenticate(&mut session, &config).await?;
        } else {
            authenticate_hop(&mut session, &config.jumps[idx + 1]).await?;
        }
    }

    crate::ssh::debug_log("ssh_connect: opening session channel");
    let mut channel = tokio::time::timeout(CONNECT_TIMEOUT, session.channel_open_session())
        .await
        .map_err(|_| "opening shell channel timed out".to_string())?
        .map_err(|e| format!("failed to open channel: {e}"))?;

    let cols = config.cols.filter(|c| *c > 0).unwrap_or(80);
    let rows = config.rows.filter(|r| *r > 0).unwrap_or(24);
    crate::ssh::debug_log("ssh_connect: requesting PTY");
    tokio::time::timeout(
        CONNECT_TIMEOUT,
        channel.request_pty(false, "xterm-256color", cols, rows, 0, 0, &[]),
    )
    .await
    .map_err(|_| "PTY request timed out".to_string())?
    .map_err(|e| format!("pty request failed: {e}"))?;
    crate::ssh::debug_log("ssh_connect: requesting shell");
    tokio::time::timeout(CONNECT_TIMEOUT, channel.request_shell(true))
        .await
        .map_err(|_| "shell request timed out".to_string())?
        .map_err(|e| format!("shell request failed: {e}"))?;
    crate::ssh::debug_log("ssh_connect: shell ready — connection established");

    let (tx, mut rx) = mpsc::unbounded_channel::<SessionCmd>();
    let session_id = new_session_id();
    manager.insert(session_id.clone(), tx);

    let fp = fingerprint.lock().unwrap().clone();

    tokio::spawn(async move {
        // Keep the connection handle (and any ProxyJump tunnels) alive for the
        // lifetime of the shell.
        let _session = session;
        let _keep_alive = keep_alive;
        loop {
            tokio::select! {
                cmd = rx.recv() => {
                    match cmd {
                        Some(SessionCmd::Data(bytes)) => {
                            if let Err(e) = channel.data(&bytes[..]).await {
                                let _ = on_event
                                    .send(SshEvent::Error { message: format!("write failed: {e}") });
                                break;
                            }
                        }
                        Some(SessionCmd::Resize { cols, rows }) => {
                            let _ = channel.window_change(cols, rows, 0, 0).await;
                        }
                        Some(SessionCmd::Close) | None => {
                            let _ = channel.eof().await;
                            break;
                        }
                    }
                }
                msg = channel.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { ref data }) => {
                            let _ = on_event.send(SshEvent::Data { data: B64.encode(data) });
                        }
                        Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                            let _ = on_event.send(SshEvent::Data { data: B64.encode(data) });
                        }
                        Some(ChannelMsg::ExitStatus { exit_status }) => {
                            let _ = on_event.send(SshEvent::Closed { code: Some(exit_status) });
                        }
                        Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => {}
                        None => {
                            let _ = on_event.send(SshEvent::Closed { code: None });
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }
    });

    Ok(SshConnectResult {
        session_id,
        fingerprint: fp,
    })
}

async fn authenticate(
    session: &mut client::Handle<ClientHandler>,
    config: &SshConnectConfig,
) -> Result<(), String> {
    tokio::time::timeout(
        CONNECT_TIMEOUT,
        authenticate_with(
            session,
            &config.username,
            &config.auth_method,
            config.password.as_deref(),
            config.private_key.as_deref(),
            config.passphrase.as_deref(),
        ),
    )
    .await
    .map_err(|_| format!("authentication with {} timed out", config.username))?
}

async fn authenticate_hop(
    session: &mut client::Handle<ClientHandler>,
    hop: &SshHop,
) -> Result<(), String> {
    tokio::time::timeout(
        CONNECT_TIMEOUT,
        authenticate_with(
            session,
            &hop.username,
            &hop.auth_method,
            hop.password.as_deref(),
            hop.private_key.as_deref(),
            hop.passphrase.as_deref(),
        ),
    )
    .await
    .map_err(|_| format!("authentication with {} timed out", hop.username))?
}

async fn authenticate_with(
    session: &mut client::Handle<ClientHandler>,
    username: &str,
    auth_method: &str,
    password: Option<&str>,
    private_key: Option<&str>,
    passphrase: Option<&str>,
) -> Result<(), String> {
    crate::ssh::debug_log(&format!("auth: method={auth_method} user={username}"));
    match auth_method {
        "password" => {
            let password = password.ok_or("password authentication requires a password")?;
            let res = session
                .authenticate_password(username, password)
                .await
                .map_err(|e| format!("authentication error: {e}"))?;
            if !res.success() {
                return Err("authentication failed (wrong password?)".into());
            }
            Ok(())
        }
        "key" => {
            let pem = private_key.ok_or("key authentication requires a private key")?;
            crate::ssh::debug_log("auth: decoding private key");
            let key = decode_secret_key(pem, passphrase)
                .map_err(|e| format!("invalid private key: {e}"))?;
            crate::ssh::debug_log("auth: negotiating rsa hash");
            let rsa_hash: Option<HashAlg> = session
                .best_supported_rsa_hash()
                .await
                .map_err(|e| format!("authentication error: {e}"))?
                .flatten();
            crate::ssh::debug_log("auth: sending publickey");
            let res = session
                .authenticate_publickey(
                    username,
                    PrivateKeyWithHashAlg::new(Arc::new(key), rsa_hash),
                )
                .await
                .map_err(|e| format!("authentication error: {e}"))?;
            if !res.success() {
                return Err("authentication failed (key rejected)".into());
            }
            Ok(())
        }
        "agent" => authenticate_agent(session, username).await,
        other => Err(format!("unsupported auth method: {other}")),
    }
}

async fn authenticate_agent(
    session: &mut client::Handle<ClientHandler>,
    username: &str,
) -> Result<(), String> {
    use russh::keys::agent::AgentIdentity;

    let mut agent = connect_agent().await?;
    let identities = agent
        .request_identities()
        .await
        .map_err(|e| format!("ssh-agent error: {e}"))?;
    if identities.is_empty() {
        return Err("ssh-agent has no identities loaded".into());
    }
    for identity in identities {
        let public_key = match identity {
            AgentIdentity::PublicKey { key, .. } => key,
            AgentIdentity::Certificate { .. } => continue,
        };
        let rsa_hash: Option<HashAlg> = session
            .best_supported_rsa_hash()
            .await
            .map_err(|e| format!("authentication error: {e}"))?
            .flatten();
        let res = session
            .authenticate_publickey_with(username, public_key, rsa_hash, &mut agent)
            .await
            .map_err(|e| format!("ssh-agent auth error: {e}"))?;
        if res.success() {
            return Ok(());
        }
    }
    Err("authentication failed (no agent identity accepted)".into())
}

type DynamicAgentClient = russh::keys::agent::client::AgentClient<
    Box<dyn russh::keys::agent::client::AgentStream + Send + Unpin>,
>;

#[cfg(unix)]
async fn connect_agent() -> Result<DynamicAgentClient, String> {
    use russh::keys::agent::client::AgentClient;

    let agent = AgentClient::connect_env()
        .await
        .map_err(|e| format!("ssh-agent unavailable: {e}"))?;
    Ok(agent.dynamic())
}

#[cfg(windows)]
async fn connect_agent() -> Result<DynamicAgentClient, String> {
    use russh::keys::agent::client::AgentClient;

    let mut errors = Vec::new();
    if let Ok(path) = std::env::var("SSH_AUTH_SOCK") {
        if !path.trim().is_empty() {
            match AgentClient::connect_named_pipe(&path).await {
                Ok(agent) => return Ok(agent.dynamic()),
                Err(e) => errors.push(format!("SSH_AUTH_SOCK={path}: {e}")),
            }
        }
    }

    let openssh_pipe = r"\\.\pipe\openssh-ssh-agent";
    match AgentClient::connect_named_pipe(openssh_pipe).await {
        Ok(agent) => return Ok(agent.dynamic()),
        Err(e) => errors.push(format!("{openssh_pipe}: {e}")),
    }

    match AgentClient::connect_pageant().await {
        Ok(agent) => Ok(agent.dynamic()),
        Err(e) => {
            errors.push(format!("Pageant: {e}"));
            Err(format!("ssh-agent unavailable: {}", errors.join("; ")))
        }
    }
}

#[tauri::command]
pub fn ssh_write(
    manager: tauri::State<'_, SshManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let bytes = B64
        .decode(data.trim())
        .map_err(|e| format!("invalid input encoding: {e}"))?;
    let tx = manager.get(&session_id).ok_or("no such session")?;
    tx.send(SessionCmd::Data(bytes))
        .map_err(|_| "session is closed".to_string())
}

#[tauri::command]
pub fn ssh_resize(
    manager: tauri::State<'_, SshManager>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let tx = manager.get(&session_id).ok_or("no such session")?;
    tx.send(SessionCmd::Resize { cols, rows })
        .map_err(|_| "session is closed".to_string())
}

#[tauri::command]
pub fn ssh_disconnect(
    manager: tauri::State<'_, SshManager>,
    session_id: String,
) -> Result<(), String> {
    if let Some(tx) = manager.take(&session_id) {
        let _ = tx.send(SessionCmd::Close);
    }
    Ok(())
}
