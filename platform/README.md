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
