/**
 * AAP runtime for Node agents.
 *
 * Handles the stdio protocol so agent authors only implement `onPrompt`:
 *  - reads newline-delimited JSON host messages (`init` / `prompt` / `abort`)
 *  - drives one {@link TurnContext} per prompt, auto-emitting `done`
 *  - serializes agent → host events with the `@@AAP@@` marker
 *
 * See ../../../src/lib/agent/aap/PROTOCOL.md for the wire contract.
 */

export const AAP_MARKER = "@@AAP@@";
export const AAP_PROTOCOL_VERSION = 1;

function writeEvent(event) {
  process.stdout.write(AAP_MARKER + JSON.stringify(event) + "\n");
}

/**
 * Per-turn context handed to `onPrompt`. Exposes typed emit helpers plus the
 * prompt input, the init config/history, and an `AbortSignal` wired to `abort`.
 */
export class TurnContext {
  constructor({ input, config, history, signal }) {
    this.input = input;
    this.config = config;
    this.history = history;
    this.signal = signal;
    this._ended = false;
    this._started = false;
  }

  get aborted() {
    return this.signal?.aborted ?? false;
  }

  assistantStart() {
    this._started = true;
    writeEvent({ type: "assistant_start" });
  }

  /** Stream an incremental chunk of assistant text. */
  assistantDelta(delta) {
    if (!this._started) this.assistantStart();
    if (delta) writeEvent({ type: "assistant_delta", delta });
  }

  /** Stream an incremental chunk of chain-of-thought text. */
  reasoningDelta(delta) {
    if (delta) writeEvent({ type: "reasoning_delta", delta });
  }

  assistantEnd(text = "") {
    this._ended = true;
    writeEvent({ type: "assistant_end", text });
  }

  toolStart({ toolCallId, toolName, args }) {
    writeEvent({ type: "tool_start", toolCallId, toolName, args });
  }

  toolEnd({ toolCallId, toolName, resultText, resultJson, isError = false }) {
    writeEvent({
      type: "tool_end",
      toolCallId,
      toolName,
      resultText: resultText ?? "",
      resultJson,
      isError,
    });
  }

  error(message) {
    writeEvent({ type: "error", message: String(message) });
  }
}

/**
 * Start the AAP read/dispatch loop for an agent implementing:
 *   - `onInit?(config, history)` — optional, called once on `init`.
 *   - `onPrompt(ctx)` — required, called per user turn.
 *
 * @param {{ onInit?: Function, onPrompt: Function, name?: string }} agent
 */
export function run(agent) {
  let config = null;
  let history = [];
  let controller = null;

  writeEvent({
    type: "ready",
    protocolVersion: AAP_PROTOCOL_VERSION,
    agent: agent.name ?? "node-agent",
  });

  async function handlePrompt(input) {
    controller = new AbortController();
    const ctx = new TurnContext({
      input,
      config,
      history,
      signal: controller.signal,
    });
    try {
      await agent.onPrompt(ctx);
      if (!ctx._ended && ctx._started) ctx.assistantEnd("");
    } catch (err) {
      ctx.error(err?.stack || err?.message || err);
    } finally {
      writeEvent({ type: "done" });
      controller = null;
    }
  }

  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (data) => {
    buffer += data;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        console.error("agent-sdk: bad json line:", line);
        continue;
      }
      if (msg.type === "init") {
        config = msg.config ?? null;
        history = msg.history ?? [];
        if (typeof agent.onInit === "function") {
          try {
            agent.onInit(config, history);
          } catch (err) {
            console.error("agent-sdk: onInit threw:", err);
          }
        }
      } else if (msg.type === "prompt") {
        void handlePrompt(msg.input ?? "");
      } else if (msg.type === "abort") {
        controller?.abort();
      }
    }
  });
  process.stdin.on("end", () => process.exit(0));
}
