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
    #[serde(default)]
    pub cols: Option<u32>,
    #[serde(default)]
    pub rows: Option<u32>,
}

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
    let client_config = Arc::new(client::Config {
        inactivity_timeout: None,
        keepalive_interval: Some(Duration::from_secs(30)),
        ..Default::default()
    });

    let fingerprint = Arc::new(StdMutex::new(None));
    let handler = ClientHandler {
        fingerprint: fingerprint.clone(),
    };

    let mut session = client::connect(
        client_config,
        (config.hostname.as_str(), config.port),
        handler,
    )
    .await
    .map_err(|e| format!("connection failed: {e}"))?;

    authenticate(&mut session, &config).await?;

    let mut channel = session
        .channel_open_session()
        .await
        .map_err(|e| format!("failed to open channel: {e}"))?;

    let cols = config.cols.unwrap_or(80);
    let rows = config.rows.unwrap_or(24);
    channel
        .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
        .await
        .map_err(|e| format!("pty request failed: {e}"))?;
    channel
        .request_shell(true)
        .await
        .map_err(|e| format!("shell request failed: {e}"))?;

    let (tx, mut rx) = mpsc::unbounded_channel::<SessionCmd>();
    let session_id = new_session_id();
    manager.insert(session_id.clone(), tx);

    let fp = fingerprint.lock().unwrap().clone();

    tokio::spawn(async move {
        // Keep the connection handle alive for the lifetime of the shell.
        let _session = session;
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
    match config.auth_method.as_str() {
        "password" => {
            let password = config
                .password
                .clone()
                .ok_or("password authentication requires a password")?;
            let res = session
                .authenticate_password(&config.username, password)
                .await
                .map_err(|e| format!("authentication error: {e}"))?;
            if !res.success() {
                return Err("authentication failed (wrong password?)".into());
            }
            Ok(())
        }
        "key" => {
            let pem = config
                .private_key
                .clone()
                .ok_or("key authentication requires a private key")?;
            let key = decode_secret_key(&pem, config.passphrase.as_deref())
                .map_err(|e| format!("invalid private key: {e}"))?;
            let rsa_hash: Option<HashAlg> = session
                .best_supported_rsa_hash()
                .await
                .map_err(|e| format!("authentication error: {e}"))?
                .flatten();
            let res = session
                .authenticate_publickey(
                    &config.username,
                    PrivateKeyWithHashAlg::new(Arc::new(key), rsa_hash),
                )
                .await
                .map_err(|e| format!("authentication error: {e}"))?;
            if !res.success() {
                return Err("authentication failed (key rejected)".into());
            }
            Ok(())
        }
        "agent" => authenticate_agent(session, config).await,
        other => Err(format!("unsupported auth method: {other}")),
    }
}

async fn authenticate_agent(
    session: &mut client::Handle<ClientHandler>,
    config: &SshConnectConfig,
) -> Result<(), String> {
    use russh::keys::agent::client::AgentClient;
    use russh::keys::agent::AgentIdentity;

    let mut agent = AgentClient::connect_env()
        .await
        .map_err(|e| format!("ssh-agent unavailable: {e}"))?;
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
            .authenticate_publickey_with(&config.username, public_key, rsa_hash, &mut agent)
            .await
            .map_err(|e| format!("ssh-agent auth error: {e}"))?;
        if res.success() {
            return Ok(());
        }
    }
    Err("authentication failed (no agent identity accepted)".into())
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
