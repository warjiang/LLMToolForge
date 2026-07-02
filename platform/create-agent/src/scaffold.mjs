// Core scaffolding logic for `create-llmtf-agent`. Pure + side-effect-light so
// it can be unit-tested: `scaffold()` computes an in-memory file map, and
// `writeFiles()` flushes it to disk.

import { mkdir, writeFile, stat } from "node:fs/promises";
import { dirname, join, isAbsolute, relative } from "node:path";

/** Frameworks we can scaffold. Maps to an AAP runtime + adapter. */
export const FRAMEWORKS = {
  langgraph: { runtime: "python", label: "LangGraph (Python)" },
  "vercel-ai": { runtime: "node", label: "Vercel AI SDK (Node)" },
};

const SDK_NODE_VERSION = "^0.1.0";
const SDK_PY_VERSION = ">=0.1.0";

/** Validate + normalize a package id into a safe slug. */
export function normalizeId(raw) {
  const id = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!id) throw new Error("agent id is empty after normalization");
  return id;
}

function titleFromId(id) {
  return id
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Build the in-memory file map for a new agent package.
 *
 * @param {object} opts
 * @param {string} opts.id            Package id (will be normalized).
 * @param {string} [opts.name]        Display name (defaults from id).
 * @param {string} [opts.description] One-line description.
 * @param {"langgraph"|"vercel-ai"} opts.framework
 * @param {string} [opts.version]     Package version (default "0.1.0").
 * @param {string} [opts.sdkPath]     Local path to the matching SDK. When set,
 *                                    dependencies resolve from disk (in-repo dev
 *                                    or vendored SDK); otherwise the registry
 *                                    package name + version is used.
 * @returns {{ runtime: string, files: Record<string,string> }}
 */
export function scaffold(opts) {
  const framework = opts.framework;
  const meta = FRAMEWORKS[framework];
  if (!meta) {
    throw new Error(
      `unknown framework "${framework}" (expected: ${Object.keys(FRAMEWORKS).join(", ")})`
    );
  }
  const id = normalizeId(opts.id);
  const name = (opts.name && opts.name.trim()) || titleFromId(id);
  const version = (opts.version && opts.version.trim()) || "0.1.0";
  const description =
    (opts.description && opts.description.trim()) ||
    `${name} — an LLMToolForge external agent built with ${meta.label}.`;

  const manifest = {
    id,
    name,
    description,
    version,
    runtime: meta.runtime,
    entry: meta.runtime === "python" ? "main.py" : "main.mjs",
    framework,
    sdkVersion: SDK_NODE_VERSION,
    defaults: {
      model: "",
      temperature: 0.7,
      maxTokens: 4096,
      systemPrompt: "You are a helpful assistant.",
    },
  };
  const agentJson = JSON.stringify(manifest, null, 2) + "\n";

  return framework === "langgraph"
    ? { runtime: "python", files: pythonFiles(id, name, agentJson, opts.sdkPath) }
    : { runtime: "node", files: nodeFiles(id, agentJson, opts.sdkPath) };
}

function pythonFiles(id, name, agentJson, sdkPath) {
  const pkgName = id;
  const sdkSource = sdkPath
    ? `\n# The SDK is resolved from a local path (in-repo dev or vendored copy).\n[tool.uv.sources]\nllmtoolforge-agent = { path = ${JSON.stringify(
        toPosix(sdkPath)
      )}, editable = true }\n`
    : "";
  const pyproject = `[project]
name = ${JSON.stringify(pkgName)}
version = "0.1.0"
requires-python = ">=3.9"
dependencies = [
    "llmtoolforge-agent${SDK_PY_VERSION}",
    "langchain-core>=0.3",
    "langchain-openai>=0.2",
    "langgraph>=0.2",
]
${sdkSource}`;

  const main = `"""${name} — a LangGraph/LangChain agent for LLMToolForge.

Runs as a subprocess speaking the Agent Adapter Protocol (AAP). The host injects
the Unified gateway base URL + local key via env; \`model_config\` reads them.
"""

from llmtoolforge_agent import run, model_config
from llmtoolforge_agent.adapters.langchain import (
    AAPCallbackHandler,
    host_tools_for_langchain,
)

from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent


def on_prompt(ctx):
    cfg = model_config(ctx.config)
    llm = ChatOpenAI(
        base_url=cfg.base_url,
        api_key=cfg.api_key,
        model=cfg.model,
        temperature=cfg.temperature if cfg.temperature is not None else 0.7,
        default_headers=cfg.headers,
        streaming=True,
    )
    handler = AAPCallbackHandler(ctx)

    # Host tools (bash / fs / grep / web_fetch / MCP / Skills) the app enabled.
    tools = host_tools_for_langchain(ctx)
    if tools:
        agent = create_react_agent(llm, tools)
        for _ in agent.stream(
            {"messages": [("user", ctx.input)]},
            config={"callbacks": [handler]},
            stream_mode="values",
        ):
            if ctx.aborted:
                break
        handler.finalize("")
    else:
        # No tools enabled: single streamed completion.
        text = ""
        for chunk in llm.stream(ctx.input, config={"callbacks": [handler]}):
            if ctx.aborted:
                break
            text += chunk.content or ""
        handler.finalize(text)


run(on_prompt, name=${JSON.stringify(id)})
`;

  const readme = `# ${name}

An [LLMToolForge](https://github.com/warjiang/LLMToolForge) external agent built
with **LangGraph + LangChain**. Model calls route through the app's Unified
gateway; the agent can call the app's built-in host tools.

## Develop

\`\`\`bash
uv venv .venv
uv pip install --python .venv -e .
\`\`\`

## Install into the app

Open **Agents → Install external agent** and pick this folder. The app builds an
isolated \`.venv\`, reads \`agent.json\`, and adds the agent to the list.

## Layout

- \`agent.json\` — package manifest (id, runtime, entry, defaults).
- \`main.py\` — entry: implements \`on_prompt(ctx)\`.
- \`pyproject.toml\` — dependencies (installed with \`uv\`).
`;

  return {
    "agent.json": agentJson,
    "main.py": main,
    "pyproject.toml": pyproject,
    "README.md": readme,
    ".gitignore": ".venv/\n__pycache__/\n*.egg-info/\n",
  };
}

function nodeFiles(id, agentJson, sdkPath) {
  const sdkDep = sdkPath ? `file:${toPosix(sdkPath)}` : SDK_NODE_VERSION;
  const pkg =
    JSON.stringify(
      {
        name: id,
        private: true,
        type: "module",
        dependencies: {
          "@ai-sdk/openai": "^1.0.0",
          ai: "^4.0.0",
          "@llmtoolforge/agent-sdk": sdkDep,
        },
      },
      null,
      2
    ) + "\n";

  const main = `// ${id} — a Vercel AI SDK agent for LLMToolForge.
//
// Runs as a subprocess speaking the Agent Adapter Protocol (AAP). The host
// injects the Unified gateway base URL + local key via env; \`modelConfig\`
// reads them.

import { run, modelConfig } from "@llmtoolforge/agent-sdk";
import {
  pipeVercelStream,
  hostToolsForVercel,
} from "@llmtoolforge/agent-sdk/adapters/vercel-ai";
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

run({
  name: ${JSON.stringify(id)},
  async onPrompt(ctx) {
    const { baseURL, apiKey, model, temperature, headers } = modelConfig(ctx.config);
    const openai = createOpenAI({ baseURL, apiKey, headers });

    const result = streamText({
      model: openai(model),
      temperature,
      messages: [{ role: "user", content: ctx.input }],
      // Host tools (bash / fs / grep / web_fetch / MCP / Skills) the app enabled.
      tools: await hostToolsForVercel(ctx),
      maxSteps: 8,
    });

    await pipeVercelStream(ctx, result);
  },
});
`;

  const readme = `# ${id}

An [LLMToolForge](https://github.com/warjiang/LLMToolForge) external agent built
with the **Vercel AI SDK**. Model calls route through the app's Unified gateway;
the agent can call the app's built-in host tools.

## Develop

\`\`\`bash
pnpm install
\`\`\`

## Install into the app

Open **Agents → Install external agent** and pick this folder. The app runs
\`pnpm install\`, reads \`agent.json\`, and adds the agent to the list.

## Layout

- \`agent.json\` — package manifest (id, runtime, entry, defaults).
- \`main.mjs\` — entry: implements \`onPrompt(ctx)\`.
- \`package.json\` — dependencies (installed with \`pnpm\`).
`;

  return {
    "agent.json": agentJson,
    "main.mjs": main,
    "package.json": pkg,
    "README.md": readme,
    ".gitignore": "node_modules/\n",
  };
}

function toPosix(p) {
  return p.split("\\").join("/");
}

/** Resolve an SDK path option to an absolute path (relative to cwd). */
export function resolveSdkPath(sdkPath, cwd = process.cwd()) {
  if (!sdkPath) return undefined;
  return isAbsolute(sdkPath) ? sdkPath : join(cwd, sdkPath);
}

/**
 * Flush a scaffold file map to `dir`. Refuses to overwrite existing files
 * unless `force` is set.
 */
export async function writeFiles(dir, files, { force = false } = {}) {
  const written = [];
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    if (!force && (await exists(abs))) {
      throw new Error(
        `refusing to overwrite existing file: ${relative(process.cwd(), abs)} (use --force)`
      );
    }
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    written.push(rel);
  }
  return written;
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
