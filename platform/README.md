# LLMToolForge Agent Platform

Build custom agents in **Python** or **Node.js** with mainstream frameworks
(LangChain/LangGraph, Vercel AI SDK, …), run them through the app's internal
**Unified gateway**, and reuse the **exact same chat interaction** as the
built-in agents.

## How it works

An external agent is just another `AgentRuntime` implementation. It runs as a
subprocess that speaks the **Agent Adapter Protocol (AAP)** over stdio; the
Tauri host (`src-tauri/src/agent_host/`) spawns it, injects the Unified gateway
URL + local key, and translates AAP events into the same
`AgentRuntimeCallbacks` the built-in Pi runtime uses — so `AgentChatView`
renders both identically.

```
AgentChatView ─▶ AgentRuntime interface
                   ├─ createAgentRuntime         (built-in Pi, in-WebView)
                   └─ createExternalAgentRuntime  (subprocess, AAP)
                          │  Tauri agent_spawn / agent_send / agent_kill
                          ▼
                   Python / Node agent subprocess
                          │  talks to  →  Unified gateway (127.0.0.1/v1)
```

The AAP wire contract is in
[`../src/lib/agent/aap/PROTOCOL.md`](../src/lib/agent/aap/PROTOCOL.md); the
TypeScript source of truth is `../src/lib/agent/aap/protocol.ts`.

## Layout

```
platform/
  node/          @llmtoolforge/agent-sdk  (Node SDK)
    src/runtime.js          AAP loop + TurnContext
    src/model.js            Unified model config from init/env
    src/adapters/vercel-ai.js
    examples/simple-agent/  Vercel AI SDK example
    test/                   offline SDK tests
  python/        llmtoolforge-agent       (Python SDK)
    llmtoolforge_agent/runtime.py         AAP loop + TurnContext
    llmtoolforge_agent/model.py
    llmtoolforge_agent/adapters/langchain.py
    examples/langgraph_agent/             LangGraph example
    tests/                  offline SDK tests
  examples/echo-agent/      framework-free AAP demo + harness
```

## Agent package format (`agent.json`)

```json
{
  "id": "my-agent",
  "name": "My Agent",
  "description": "…",
  "runtime": "python",        // python | node
  "entry": "main.py",
  "framework": "langgraph",
  "defaults": { "model": "", "temperature": 0.7, "maxTokens": 4096, "systemPrompt": "" }
}
```

At install the host builds an isolated environment (zero-config):
- **Python**: `uv venv` + `uv pip install -e .`
- **Node**: `pnpm install`

(Rust command `agent_build_env`.)

## Run the tests (offline, no network)

```sh
# Protocol + interaction reuse (framework-free)
node platform/examples/echo-agent/test-harness.mjs

# Node SDK core + Vercel adapter mapping
node platform/node/test/runtime.test.mjs

# Python SDK core + LangChain adapter mapping
python3 platform/python/tests/test_runtime.py
```

## In-app smoke test (echo agent, no framework/model)

The offline harness above only exercises the pure-Node AAP round-trip. To verify
the **full in-app path** — Rust `agent_host` → AAP events → the shared
`AgentChatView` — use the framework-free **echo agent**. It needs no framework
deps and never calls the model, so it isolates the interaction-reuse plumbing.

Until the "install external agent" UI lands, register it manually:

1. Launch from a terminal so `node` is on the app's `PATH` and the gateway is
   available:
   ```sh
   pnpm tauri dev
   ```
2. In the **Unified API** page, enable at least one model and copy its exposed id
   (`{conn}/{model}`). The echo agent won't call it, but runtime creation
   requires a valid `modelId`.
3. Open devtools (`Cmd+Option+I`) → Console and seed one external
   `AgentDefinition` via the app's own store (WKWebView has no top-level
   `await`, so wrap in an IIFE):
   ```js
   (async () => {
     const { useAgentDefStore } = await import("/src/store/index.ts");
     await useAgentDefStore.getState().add({
       name: "Echo Agent (dev)", description: "AAP smoke test",
       systemPrompt: "", modelId: "<conn>/<model>",
       enabledInternalTools: [], enabledSkillIds: [], enabledMcpServerIds: [],
       sandboxMode: "workspace-write", workspacePath: "",
       temperature: 0.7, maxTokens: 4096,
       kind: "external",
       external: {
         packageId: "echo-agent", runtime: "node", entry: "main.mjs",
         packageDir: "<repo>/platform/examples/echo-agent",
         envPath: "", framework: "none",
       },
     });
   })();
   ```
4. Pick **Echo Agent (dev)** in the agent dropdown and send a message. Expect a
   streamed `echo: <input>`, a short reasoning trace, and one `echo` tool
   card — rendered by the same UI as the built-in agents.

Host-side subprocess logs (stderr) surface in the `pnpm tauri dev` terminal as
`[agent <runId>][stderr] …`.

## Write your own

### Node
```js
import { run, modelConfig } from "@llmtoolforge/agent-sdk";

run({
  name: "my-agent",
  async onPrompt(ctx) {
    ctx.assistantStart();
    ctx.assistantDelta("hello");
    ctx.assistantEnd("hello");
  },
});
```

### Python
```python
from llmtoolforge_agent import run

def on_prompt(ctx):
    ctx.assistant_start()
    ctx.assistant_delta("hello")
    ctx.assistant_end("hello")

run(on_prompt, name="my-agent")
```

The host provides the Unified gateway via `ctx.config` (and
`UNIFIED_BASE_URL` / `UNIFIED_API_KEY` / `UNIFIED_MODEL` env), so point any
OpenAI-compatible client at `modelConfig(ctx.config)`.

## End-to-end verification (offline)

`examples/e2e-harness.mjs` mimics what the Rust `agent_host` does at runtime,
without cloud credentials. It boots a mock OpenAI-compatible gateway
(`examples/mock-gateway.mjs`), spawns each example agent as a subprocess with
`UNIFIED_*` env injected, sends AAP `init` + `prompt`, and asserts the streamed
event sequence (`ready → assistant_start → assistant_delta… → assistant_end →
done`) plus the `abort` contract.

This exercises the real framework code paths — Python LangChain `ChatOpenAI`
streaming and Node Vercel AI `streamText` — end to end.

```sh
# one-time: build the example isolated envs (what the host does at install)
(cd node/examples/simple-agent && pnpm install)
(cd python/examples/langgraph_agent && uv venv && uv pip install -e .)

# run the harness
node examples/e2e-harness.mjs
```

## Host tools (Phase 2 reverse bridge)

External agents can call the app's built-in tools — bash, file I/O, grep,
web_fetch, MCP tools, and Skills — without reimplementing them. The host
advertises the enabled tools in `init.hostTools`; the agent calls them back and
every call runs through the **same sandbox + human-approval** path as the
built-in agent, and shows up in the chat UI as a normal tool call.

### Node
```js
import { run, modelConfig } from "@llmtoolforge/agent-sdk";
import { pipeVercelStream, hostToolsForVercel } from "@llmtoolforge/agent-sdk/adapters/vercel-ai";
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

run({
  name: "my-agent",
  async onPrompt(ctx) {
    const { baseURL, apiKey, model } = modelConfig(ctx.config);
    const openai = createOpenAI({ baseURL, apiKey });
    const result = streamText({
      model: openai(model),
      messages: [{ role: "user", content: ctx.input }],
      tools: await hostToolsForVercel(ctx), // host tools as LLM tools
      maxSteps: 8,
    });
    await pipeVercelStream(ctx, result);
  },
});
```
Or call one directly: `const r = await ctx.callHostTool("bash", { command: "ls" });`

### Python
```python
from llmtoolforge_agent import run, model_config
from llmtoolforge_agent.adapters.langchain import AAPCallbackHandler, host_tools_for_langchain
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

def on_prompt(ctx):
    cfg = model_config(ctx.config)
    llm = ChatOpenAI(base_url=cfg.base_url, api_key=cfg.api_key, model=cfg.model, streaming=True)
    handler = AAPCallbackHandler(ctx)
    agent = create_react_agent(llm, host_tools_for_langchain(ctx))
    for chunk in agent.stream({"messages": [("user", ctx.input)]},
                              config={"callbacks": [handler]}, stream_mode="values"):
        pass
    handler.finalize("")

run(on_prompt, name="my-agent")
```
Or call one directly: `r = ctx.call_host_tool("bash", {"command": "ls"})`.

## Scaffolding a new agent (create-llmtf-agent)

Bootstrap a new agent package instead of copying an example:

```bash
node create-agent/bin/create-llmtf-agent.mjs my-agent --framework vercel-ai
# or
node create-agent/bin/create-llmtf-agent.mjs my-agent --framework langgraph
```

Use `--sdk-path ../node` / `--sdk-path ../python` to resolve the in-repo SDK
during local development. See `create-agent/README.md` for the full option list.

The generated `agent.json` includes a `version` field, surfaced in the app's
install dialog and agent list badge. On install the app also pre-checks that the
required toolchain (`uv` for Python, `pnpm` for Node) is present and emits an
actionable error with an install link when it is missing.

## Call attribution (monitor)

Every model call routes through the app's Unified gateway, which logs each
request in the **Monitor** tab. To make external-agent calls attributable, the
host assigns each agent a stable User-Agent
(`LLMToolForge-Agent/<packageId> (<framework>; <runtime>)`) via the `init`
config (`config.userAgent`) and the `UNIFIED_USER_AGENT` env var.

`modelConfig()` / `model_config()` surface it as a ready-to-spread `headers`
object — apply it to your provider client so the gateway records it:

```js
const { baseURL, apiKey, model, headers } = modelConfig(ctx.config);
const openai = createOpenAI({ baseURL, apiKey, headers });
```

```python
cfg = model_config(ctx.config)
llm = ChatOpenAI(base_url=cfg.base_url, api_key=cfg.api_key, model=cfg.model,
                 default_headers=cfg.headers)
```

The Monitor tab then shows a **Requests by Source** breakdown, a per-row
**Source** column, and a source filter — so you can see exactly how much traffic
each agent generates. The scaffolded templates wire `headers` in by default.
