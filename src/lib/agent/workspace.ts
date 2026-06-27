import { isTauri } from "@/lib/utils";

/**
 * Resolve the effective execution root for a chat session.
 *
 * When the user has not set an explicit workspace path, this defaults to a
 * per-session directory under `~/.llmtoolforge/sessions/<sessionId>`, creating
 * it on demand. All of the session's tool artifacts live there. An explicit
 * path is returned (and created) as-is.
 *
 * Outside the Tauri desktop runtime there is no filesystem to manage, so the
 * trimmed explicit path is returned unchanged.
 */
export async function resolveSessionWorkspace(
  sessionId: string,
  workspacePath: string
): Promise<string> {
  const explicit = (workspacePath ?? "").trim();
  if (!isTauri()) return explicit;
  // Without a session id we cannot derive a per-session default; fall back to
  // the explicit path (possibly empty -> backend managed sandbox).
  if (!explicit && !sessionId.trim()) return explicit;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("ensure_session_workspace", {
    sessionId,
    workspacePath: explicit,
  });
}

/**
 * Remove the managed per-session workspace directory
 * (`~/.llmtoolforge/sessions/<sessionId>`) when deleting a conversation.
 *
 * Best-effort and safe by design: the backend only ever deletes the managed
 * default directory (never an explicit user workspace), and a missing
 * directory — e.g. for legacy sessions that never created one — is a no-op.
 * Failures are swallowed so they can never block session deletion.
 */
export async function deleteSessionWorkspace(sessionId: string): Promise<void> {
  if (!isTauri()) return;
  if (!sessionId.trim()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_session_workspace", { sessionId });
  } catch (e) {
    console.warn("Failed to delete session workspace", sessionId, e);
  }
}
