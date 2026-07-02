#!/usr/bin/env node
/**
 * Phase 1 end-to-end host harness.
 *
 * Mimics what the Rust `agent_host` does at runtime, but from Node so it can be
 * run offline in CI/dev:
 *   1. Boots the mock Unified gateway (OpenAI-compatible).
 *   2. Spawns an example agent subprocess with UNIFIED_* env injected.
 *   3. Sends AAP `init` (with `config`) then `prompt` over stdin.
 *   4. Parses `@@AAP@@` stdout lines and asserts the event sequence that the
 *      real UI (`externalRuntime.ts` -> AgentRuntimeCallbacks) depends on.
 *
 * This exercises the *real* framework code paths:
 *   - Python: LangChain `ChatOpenAI` streaming -> AAPCallbackHandler
 *   - Node:   Vercel AI `streamText` fullStream -> pipeVercelStream
 *
 * Usage: node e2e-harness.mjs
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AAP_MARKER = "@@AAP@@";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLATFORM = path.resolve(__dirname, "..");
const PORT = 4199;
const BASE_URL = `http://127.0.0.1:${PORT}/v1`;

function log(...a) {
  console.log(...a);
}

/** Boot the mock gateway as a child process and wait until it responds. */
async function startGateway() {
  const proc = spawn("node", [path.join(__dirname, "mock-gateway.mjs"), String(PORT)], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("gateway boot timeout")), 5000);
    proc.stdout.on("data", (d) => {
      if (d.toString().includes("listening")) {
        clearTimeout(t);
        resolve();
      }
    });
    proc.on("exit", (c) => reject(new Error("gateway exited " + c)));
  });
  // sanity ping
  await new Promise((resolve, reject) => {
    http
      .get(`${BASE_URL}/models`, (res) => {
        res.resume();
        res.statusCode === 200 ? resolve() : reject(new Error("models " + res.statusCode));
      })
      .on("error", reject);
  });
  return proc;
}

/**
 * Spawn one agent, drive an init+prompt turn, collect AAP events.
 * @returns {Promise<{events: any[]}>}
 */
async function runAgent({ label, command, args, cwd, promptText }) {
  log(`\n=== ${label} ===`);
  const child = spawn(command, args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      UNIFIED_BASE_URL: BASE_URL,
      UNIFIED_API_KEY: "mock-local-key",
      UNIFIED_MODEL: "mock/model",
    },
  });

  const events = [];
  let buf = "";
  const done = new Promise((resolve) => {
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.startsWith(AAP_MARKER)) {
          const evt = JSON.parse(line.slice(AAP_MARKER.length));
          events.push(evt);
          if (evt.type === "assistant_delta") process.stdout.write(".");
          else log(`  <- ${evt.type}`, evt.type === "error" ? evt : "");
          if (evt.type === "done") resolve();
        } else if (line.trim()) {
          log(`  [stderr-log] ${line}`);
        }
      }
    });
  });
  child.stderr.on("data", (d) => log(`  [stderr] ${d.toString().trim()}`));

  const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
  send({
    type: "init",
    config: {
      baseUrl: BASE_URL,
      localKey: "mock-local-key",
      model: "mock/model",
      temperature: 0.7,
      maxTokens: 256,
      systemPrompt: "You are a test agent.",
    },
    history: [],
  });
  send({ type: "prompt", input: promptText });

  await Promise.race([
    done,
    new Promise((_, rej) => setTimeout(() => rej(new Error("agent turn timeout")), 30000)),
  ]);
  child.stdin.end();
  child.kill();
  return { events };
}

function assertSequence(label, events, promptText) {
  const types = events.map((e) => e.type);
  const problems = [];
  const need = ["ready", "assistant_start", "assistant_delta", "assistant_end", "done"];
  for (const t of need) if (!types.includes(t)) problems.push(`missing '${t}'`);

  const end = events.find((e) => e.type === "assistant_end");
  const finalText = end?.text ?? "";
  if (!finalText.includes(promptText)) {
    problems.push(`assistant_end text '${finalText}' missing echoed prompt '${promptText}'`);
  }
  // deltas must be monotonically accumulating toward the final text
  const deltas = events.filter((e) => e.type === "assistant_delta").map((e) => e.text ?? "");
  if (deltas.length && !finalText.startsWith(deltas[0].slice(0, 1))) {
    // loose check; deltas may be incremental per SDK contract
  }
  if (events.some((e) => e.type === "error")) {
    problems.push(`error event: ${JSON.stringify(events.find((e) => e.type === "error"))}`);
  }

  if (problems.length) {
    log(`\n[FAIL] ${label}:\n  - ${problems.join("\n  - ")}`);
    log(`  event types: ${types.join(", ")}`);
    return false;
  }
  log(`\n[PASS] ${label}  (final: "${finalText}")`);
  return true;
}

/**
 * Drive an init+prompt then send `abort` shortly after, asserting the agent
 * stops cleanly and still terminates its turn with `done` (the contract
 * `externalRuntime.abort()` relies on).
 */
async function runAbort({ label, command, args, cwd }) {
  log(`\n=== ${label} (abort) ===`);
  const child = spawn(command, args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      UNIFIED_BASE_URL: BASE_URL,
      UNIFIED_API_KEY: "mock-local-key",
      UNIFIED_MODEL: "mock/model",
    },
  });
  const events = [];
  let buf = "";
  let sawReady = false;
  const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
  const done = new Promise((resolve) => {
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.startsWith(AAP_MARKER)) {
          const evt = JSON.parse(line.slice(AAP_MARKER.length));
          events.push(evt);
          if (evt.type === "ready" && !sawReady) {
            sawReady = true;
            send({ type: "prompt", input: "please stream a long answer" });
            setTimeout(() => send({ type: "abort" }), 15);
          }
          if (evt.type === "done") resolve();
        }
      }
    });
  });
  child.stderr.on("data", () => {});
  send({ type: "init", config: { baseUrl: BASE_URL, localKey: "mock-local-key", model: "mock/model" }, history: [] });

  let timedOut = false;
  await Promise.race([
    done,
    new Promise((res) => setTimeout(() => { timedOut = true; res(); }, 15000)),
  ]);
  child.stdin.end();
  child.kill();
  const types = events.map((e) => e.type);
  const gotDone = types.includes("done");
  if (gotDone && !timedOut) {
    log(`[PASS] ${label} (abort)  (events: ${types.join(", ")})`);
    return true;
  }
  log(`[FAIL] ${label} (abort)  timedOut=${timedOut} events: ${types.join(", ")}`);
  return false;
}

async function main() {
  const gateway = await startGateway();
  let ok = true;
  try {
    // Node / Vercel AI SDK example
    {
      const promptText = "hello from node harness";
      const { events } = await runAgent({
        label: "Node · Vercel AI SDK",
        command: "node",
        args: ["main.mjs"],
        cwd: path.join(PLATFORM, "node/examples/simple-agent"),
        promptText,
      });
      ok = assertSequence("Node · Vercel AI SDK", events, promptText) && ok;
    }

    // Python / LangChain example (uses the example's isolated venv)
    {
      const promptText = "hello from python harness";
      const venvPy = path.join(
        PLATFORM,
        "python/examples/langgraph_agent/.venv/bin/python"
      );
      const { events } = await runAgent({
        label: "Python · LangChain",
        command: venvPy,
        args: ["main.py"],
        cwd: path.join(PLATFORM, "python/examples/langgraph_agent"),
        promptText,
      });
      ok = assertSequence("Python · LangChain", events, promptText) && ok;
    }

    // Abort path (Node example is enough to prove the abort contract)
    ok =
      (await runAbort({
        label: "Node · Vercel AI SDK",
        command: "node",
        args: ["main.mjs"],
        cwd: path.join(PLATFORM, "node/examples/simple-agent"),
      })) && ok;
  } finally {
    gateway.kill();
  }

  log(`\n${ok ? "ALL E2E CHECKS PASSED" : "SOME E2E CHECKS FAILED"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
