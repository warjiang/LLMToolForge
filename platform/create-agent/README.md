# create-llmtf-agent

Scaffold a new [LLMToolForge](https://github.com/warjiang/LLMToolForge) external
agent package that speaks the Agent Adapter Protocol (AAP). Generates a ready-to
-install project wired to the SDK and the Phase 2 host-tool bridge.

## Usage

```bash
# Non-interactive
node bin/create-llmtf-agent.mjs my-agent --framework vercel-ai
node bin/create-llmtf-agent.mjs my-agent --framework langgraph

# Interactive (prompts for missing dir / framework on a TTY)
node bin/create-llmtf-agent.mjs
```

Once published you'd run it via `npm create llmtf-agent@latest <dir>`.

### Options

| Option              | Description                                                        |
| ------------------- | ----------------------------------------------------------------- |
| `--framework <name>`| `langgraph` (Python) or `vercel-ai` (Node). Required.             |
| `--id <id>`         | Package id slug. Defaults to the target directory name.           |
| `--name <name>`     | Display name.                                                     |
| `--description <s>` | One-line description.                                             |
| `--version <semver>`| Package version written to `agent.json` (default `0.1.0`).        |
| `--sdk-path <path>` | Resolve the SDK from a local path (in-repo dev / vendored copy).  |
| `--force`           | Overwrite existing files.                                         |

### `--sdk-path`

The SDKs (`@llmtoolforge/agent-sdk`, `llmtoolforge-agent`) are not yet published
to npm / PyPI. For local development, point `--sdk-path` at the matching SDK dir
so the generated project resolves it from disk:

```bash
# Node agent resolving the in-repo SDK
node bin/create-llmtf-agent.mjs my-agent --framework vercel-ai \
  --sdk-path ../node

# Python agent resolving the in-repo SDK
node bin/create-llmtf-agent.mjs my-agent --framework langgraph \
  --sdk-path ../python
```

Without `--sdk-path`, dependencies point at the registry package name + version.

## What it generates

**Python (`langgraph`)**: `agent.json`, `main.py` (LangGraph `create_react_agent`
loop with host tools), `pyproject.toml`, `README.md`, `.gitignore`.

**Node (`vercel-ai`)**: `agent.json`, `main.mjs` (`streamText` with host tools),
`package.json`, `README.md`, `.gitignore`.

The generated `agent.json` carries a `version` field surfaced in the app's
install dialog and agent list.

## Test

```bash
node test/scaffold.test.mjs
```
