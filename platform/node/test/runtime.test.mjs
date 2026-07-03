/**
 * Node SDK offline tests: exercise the AAP runtime loop and the Vercel adapter's
 * stream mapping without any network or `ai` dependency.
 *
 *   node platform/node/test/runtime.test.mjs
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

import { TurnContext } from "../src/runtime.js";
import { pipeVercelStream } from "../src/adapters/vercel-ai.js";
import { modelConfig } from "../src/model.js";

const here = dirname(fileURLToPath(import.meta.url));
const MARKER = "@@AAP@@";

// --- Test 1: the runtime loop drives a canned agent through a full turn --------
async function testRuntimeLoop() {
  const agentPath = join(here, "fixtures", "canned-agent.mjs");
  const child = spawn("node", [agentPath], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const events = [];
  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith(MARKER)) events.push(JSON.parse(line.slice(MARKER.length)));
    }
  });
  const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");

  send({
    type: "init",
    protocolVersion: 1,
    config: { baseUrl: "x", localKey: "y", model: "m", systemPrompt: "", temperature: 0.7, maxTokens: 100 },
    history: [],
  });
  send({ type: "prompt", input: "hi" });

  const deadline = Date.now() + 4000;
  while (Date.now() < deadline && !events.some((e) => e.type === "done")) {
    await new Promise((r) => setTimeout(r, 30));
  }
  child.stdin.end();
  child.kill();

  const types = events.map((e) => e.type);
  assert.ok(types.includes("ready"), "ready emitted");
  assert.ok(types.includes("assistant_start"), "assistant_start emitted");
  assert.ok(types.includes("assistant_delta"), "assistant_delta emitted");
  assert.ok(types.includes("assistant_end"), "assistant_end emitted");
  assert.equal(types[types.length - 1], "done", "done is last");
  const acc = events.filter((e) => e.type === "assistant_delta").reduce((s, e) => s + e.delta, "");
  assert.equal(acc, "hello from canned agent", "accumulated text");
  console.log("PASS: runtime loop");
}

// --- Test 2: the Vercel adapter maps a fake fullStream to AAP events -----------
async function testVercelAdapter() {
  const emitted = [];
  const ctx = new TurnContext({ input: "q", config: {}, history: [], signal: undefined });
  // Capture emits by monkeypatching stdout.write for this synchronous section.
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => {
    if (typeof s === "string" && s.startsWith(MARKER)) {
      emitted.push(JSON.parse(s.slice(MARKER.length)));
      return true;
    }
    return origWrite(s);
  };

  const fakeResult = {
    async *fullStreamGen() {},
    fullStream: (async function* () {
      yield { type: "reasoning", textDelta: "thinking" };
      yield { type: "text-delta", textDelta: "Hello" };
      yield { type: "text-delta", textDelta: " world" };
      yield { type: "tool-call", toolCallId: "t1", toolName: "search", args: { q: "x" } };
      yield { type: "tool-result", toolCallId: "t1", toolName: "search", result: { hits: 3 } };
      yield { type: "finish" };
    })(),
    text: Promise.resolve("Hello world"),
  };

  await pipeVercelStream(ctx, fakeResult);
  process.stdout.write = origWrite;

  const types = emitted.map((e) => e.type);
  assert.ok(types.includes("reasoning_delta"), "reasoning mapped");
  assert.ok(types.includes("tool_start"), "tool_start mapped");
  assert.ok(types.includes("tool_end"), "tool_end mapped");
  const end = emitted.find((e) => e.type === "assistant_end");
  assert.equal(end.text, "Hello world", "assistant_end text");
  const toolEnd = emitted.find((e) => e.type === "tool_end");
  assert.deepEqual(toolEnd.resultJson, { hits: 3 }, "tool result json");
  console.log("PASS: vercel adapter mapping");
}

async function main() {
  await testRuntimeLoop();
  await testVercelAdapter();
  await testHostToolBridge();
  await testModelConfig();
  console.log("ALL NODE SDK TESTS PASSED");
}

// --- Test 4: modelConfig surfaces userAgent + headers for call attribution ---
async function testModelConfig() {
  // From init config: userAgent → headers["User-Agent"].
  const cfg = modelConfig({
    baseUrl: "http://gw/v1",
    localKey: "k",
    model: "conn/m",
    temperature: 0.3,
    maxTokens: 512,
    userAgent: "LLMToolForge-Agent/my-agent (vercel-ai; node)",
  });
  assert.equal(cfg.baseURL, "http://gw/v1");
  assert.equal(cfg.apiKey, "k");
  assert.equal(cfg.model, "conn/m");
  assert.equal(cfg.temperature, 0.3);
  assert.equal(cfg.maxTokens, 512);
  assert.equal(cfg.userAgent, "LLMToolForge-Agent/my-agent (vercel-ai; node)");
  assert.equal(cfg.headers["User-Agent"], cfg.userAgent);

  // Env fallback when no init config is provided.
  const prev = { ...process.env };
  process.env.UNIFIED_BASE_URL = "http://env/v1";
  process.env.UNIFIED_API_KEY = "envkey";
  process.env.UNIFIED_MODEL = "env/model";
  process.env.UNIFIED_USER_AGENT = "LLMToolForge-Agent/env-agent (langgraph; python)";
  process.env.UNIFIED_TEMPERATURE = "0.9";
  const envCfg = modelConfig(null);
  assert.equal(envCfg.baseURL, "http://env/v1");
  assert.equal(envCfg.userAgent, "LLMToolForge-Agent/env-agent (langgraph; python)");
  assert.equal(envCfg.headers["User-Agent"], envCfg.userAgent);
  assert.equal(envCfg.temperature, 0.9);

  // No userAgent → empty headers object (nothing to attribute).
  delete process.env.UNIFIED_USER_AGENT;
  const bare = modelConfig({ baseUrl: "b", localKey: "l", model: "m" });
  assert.deepEqual(bare.headers, {});
  process.env = prev;

  console.log("PASS: modelConfig userAgent/headers");
}

// --- Test 3: the reverse bridge round-trips host_tool_call/result -------------
async function testHostToolBridge() {
  const agentPath = join(here, "fixtures", "host-tool-agent.mjs");
  const child = spawn("node", [agentPath], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const events = [];
  let buf = "";
  const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith(MARKER)) continue;
      const evt = JSON.parse(line.slice(MARKER.length));
      events.push(evt);
      // Act as the host: fulfil the tool call.
      if (evt.type === "host_tool_call") {
        assert.equal(evt.toolName, "echo_host", "host tool name");
        assert.deepEqual(evt.args, { msg: "ping" }, "host tool args forwarded");
        send({
          type: "host_tool_result",
          callId: evt.callId,
          toolName: evt.toolName,
          resultText: `echo:${evt.args.msg}`,
          resultJson: { echoed: evt.args.msg },
          isError: false,
        });
      }
    }
  });

  send({
    type: "init",
    protocolVersion: 1,
    config: { baseUrl: "x", localKey: "y", model: "m", systemPrompt: "", temperature: 0.7, maxTokens: 100 },
    history: [],
    hostTools: [
      { name: "echo_host", description: "echo", parameters: { type: "object", properties: { msg: { type: "string" } } } },
    ],
  });
  send({ type: "prompt", input: "ping" });

  const deadline = Date.now() + 4000;
  while (Date.now() < deadline && !events.some((e) => e.type === "done")) {
    await new Promise((r) => setTimeout(r, 30));
  }
  child.stdin.end();
  child.kill();

  const types = events.map((e) => e.type);
  assert.ok(types.includes("host_tool_call"), "host_tool_call emitted");
  const end = events.find((e) => e.type === "assistant_end");
  assert.equal(end.text, "result=echo:ping", "bridged result used by agent");
  const manifestDelta = events.find(
    (e) => e.type === "assistant_delta" && e.delta.startsWith("tools=")
  );
  assert.ok(
    manifestDelta && manifestDelta.delta.includes("echo_host"),
    "host tool manifest delivered via init"
  );
  console.log("PASS: host tool bridge");
}

main().catch((e) => {
  console.error("TEST FAILURE:", e);
  process.exit(1);
});
