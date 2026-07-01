#!/usr/bin/env node
/**
 * Echo agent — the minimal AAP-speaking agent, with no framework and no model
 * call. It exists to prove the Phase 0 pipeline end-to-end: host → subprocess →
 * AAP events → the shared LLMToolForge chat runtime.
 *
 * Protocol: read newline-delimited JSON on stdin (`init` / `prompt` / `abort`);
 * emit marker-prefixed AAP events on stdout.
 * See ../../../src/lib/agent/aap/PROTOCOL.md
 *
 * Behaviour on each prompt:
 *   assistant_start
 *   reasoning_delta*   (a short fake "thought")
 *   tool_start(echo) / tool_end(echo)   (demonstrates tool events)
 *   assistant_delta*   (streams the echoed text word by word)
 *   assistant_end
 *   done
 */

const MARKER = "@@AAP@@";

function emit(event) {
  process.stdout.write(MARKER + JSON.stringify(event) + "\n");
}

/** Cooperative sleep so streaming is visible in the UI. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let config = null;
let aborted = false;

async function handlePrompt(input) {
  aborted = false;
  emit({ type: "assistant_start" });

  for (const chunk of ["Echoing", " your", " message…"]) {
    if (aborted) break;
    emit({ type: "reasoning_delta", delta: chunk });
    await sleep(30);
  }

  const toolCallId = "echo-" + Date.now();
  emit({ type: "tool_start", toolName: "echo", toolCallId, args: { input } });
  await sleep(20);
  emit({
    type: "tool_end",
    toolName: "echo",
    toolCallId,
    resultText: input,
    resultJson: { echoed: input, model: config?.model ?? null },
    isError: false,
  });

  const prefix = "echo: ";
  let full = prefix;
  emit({ type: "assistant_delta", delta: prefix });
  for (const word of String(input).split(/(\s+)/)) {
    if (aborted) break;
    full += word;
    emit({ type: "assistant_delta", delta: word });
    await sleep(20);
  }

  emit({ type: "assistant_end", text: full });
  emit({ type: "done" });
}

function handleLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    console.error("echo-agent: bad json line:", trimmed);
    return;
  }
  if (msg.type === "init") {
    config = msg.config ?? null;
  } else if (msg.type === "prompt") {
    void handlePrompt(msg.input ?? "");
  } else if (msg.type === "abort") {
    aborted = true;
  }
}

function main() {
  emit({ type: "ready", protocolVersion: 1, agent: "echo-agent" });

  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (data) => {
    buffer += data;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      handleLine(line);
    }
  });
  process.stdin.on("end", () => process.exit(0));
}

main();
