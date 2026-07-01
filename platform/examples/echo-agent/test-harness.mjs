#!/usr/bin/env node
/**
 * Offline AAP harness — verifies the echo agent speaks the protocol correctly
 * without needing the Tauri host or a running gateway. Mirrors what the Rust
 * `agent_host` does: spawn the agent, write host messages to stdin, parse
 * `@@AAP@@` lines from stdout, and assert the expected event sequence.
 *
 *   node platform/examples/echo-agent/test-harness.mjs
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MARKER = "@@AAP@@";
const here = dirname(fileURLToPath(import.meta.url));
const agent = join(here, "main.mjs");

const child = spawn("node", [agent], { stdio: ["pipe", "pipe", "inherit"] });

const events = [];
let buffer = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line.startsWith(MARKER)) {
      events.push(JSON.parse(line.slice(MARKER.length)));
    }
  }
});

const send = (msg) => child.stdin.write(JSON.stringify(msg) + "\n");

function fail(reason) {
  console.error("FAIL:", reason);
  console.error("events:", JSON.stringify(events, null, 2));
  child.kill();
  process.exit(1);
}

async function run() {
  send({
    type: "init",
    protocolVersion: 1,
    config: {
      baseUrl: "http://127.0.0.1:4141/v1",
      localKey: "sk-local-test",
      model: "test/model",
      systemPrompt: "",
      temperature: 0.7,
      maxTokens: 4096,
    },
    history: [],
  });
  send({ type: "prompt", input: "hello world" });

  // Wait for the `done` event or time out.
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (events.some((e) => e.type === "done")) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  child.stdin.end();

  const types = events.map((e) => e.type);
  const expectSeq = [
    "ready",
    "assistant_start",
    "reasoning_delta",
    "tool_start",
    "tool_end",
    "assistant_delta",
    "assistant_end",
    "done",
  ];
  for (const t of expectSeq) {
    if (!types.includes(t)) fail(`missing event: ${t}`);
  }

  const end = events.find((e) => e.type === "assistant_end");
  if (!end || end.text !== "echo: hello world") {
    fail(`bad assistant_end text: ${JSON.stringify(end)}`);
  }
  const toolEnd = events.find((e) => e.type === "tool_end");
  if (!toolEnd || toolEnd.resultJson?.echoed !== "hello world") {
    fail(`bad tool_end: ${JSON.stringify(toolEnd)}`);
  }

  // Reconstruct accumulated assistant text from deltas (as the host runtime does).
  const acc = events
    .filter((e) => e.type === "assistant_delta")
    .reduce((s, e) => s + e.delta, "");
  if (acc !== "echo: hello world") fail(`bad accumulated text: ${acc}`);

  console.log("PASS: AAP echo round-trip");
  console.log("  event order:", types.join(" → "));
  child.kill();
  process.exit(0);
}

run();
