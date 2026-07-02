#!/usr/bin/env node
// create-llmtf-agent — scaffold a new LLMToolForge external agent package.
//
// Usage:
//   create-llmtf-agent <dir> [--framework langgraph|vercel-ai] [--id <id>]
//                            [--name <name>] [--description <text>]
//                            [--sdk-path <path>] [--force]
//
// Non-interactive when --framework (and a target dir) are provided; otherwise
// prompts on the terminal.

import { join, basename, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  scaffold,
  writeFiles,
  resolveSdkPath,
  normalizeId,
  FRAMEWORKS,
} from "../src/scaffold.mjs";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") args.force = true;
    else if (a === "-h" || a === "--help") args.help = true;
    else if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val === undefined || val.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = val;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

const HELP = `create-llmtf-agent — scaffold an LLMToolForge external agent

Usage:
  create-llmtf-agent <dir> [options]

Options:
  --framework <name>   ${Object.keys(FRAMEWORKS).join(" | ")}
  --id <id>            Package id (slug). Defaults to the target dir name.
  --name <name>        Display name.
  --description <text> One-line description.
  --version <semver>   Package version (default 0.1.0).
  --sdk-path <path>    Resolve the SDK from a local path (in-repo dev / vendored).
  --force              Overwrite existing files.
  -h, --help           Show this help.
`;

async function maybePrompt(args) {
  // Only prompt for genuinely missing required inputs, and only when on a TTY.
  const interactive = stdin.isTTY && stdout.isTTY;
  let dir = args._[0];
  let framework = args.framework;

  if ((!dir || !framework) && interactive) {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      if (!dir) {
        dir = (await rl.question("Target directory: ")).trim();
      }
      if (!framework) {
        const keys = Object.keys(FRAMEWORKS);
        const list = keys
          .map((k, i) => `  ${i + 1}) ${k} — ${FRAMEWORKS[k].label}`)
          .join("\n");
        const ans = (
          await rl.question(`Framework:\n${list}\nChoose [1]: `)
        ).trim();
        framework = /^\d+$/.test(ans) ? keys[Number(ans) - 1] : ans || keys[0];
      }
    } finally {
      rl.close();
    }
  }
  return { dir, framework };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    stdout.write(HELP);
    return;
  }

  const { dir, framework } = await maybePrompt(args);
  if (!dir) {
    stderr("error: missing target directory\n\n" + HELP);
    process.exitCode = 1;
    return;
  }
  if (!framework || !FRAMEWORKS[framework]) {
    stderr(
      `error: --framework must be one of: ${Object.keys(FRAMEWORKS).join(", ")}\n`
    );
    process.exitCode = 1;
    return;
  }

  const targetDir = resolve(process.cwd(), dir);
  const id = normalizeId(args.id || basename(targetDir));
  const sdkPath = resolveSdkPath(args["sdk-path"]);

  let result;
  try {
    result = scaffold({
      id,
      name: typeof args.name === "string" ? args.name : undefined,
      description:
        typeof args.description === "string" ? args.description : undefined,
      version: typeof args.version === "string" ? args.version : undefined,
      framework,
      sdkPath,
    });
    const written = await writeFiles(targetDir, result.files, {
      force: Boolean(args.force),
    });
    stdout.write(`\nScaffolded ${framework} agent "${id}" (${result.runtime})\n`);
    stdout.write(`  ${targetDir}\n`);
    for (const f of written) stdout.write(`    + ${f}\n`);
    stdout.write("\nNext steps:\n");
    if (result.runtime === "python") {
      stdout.write(`  cd ${dir}\n  uv venv .venv && uv pip install --python .venv -e .\n`);
    } else {
      stdout.write(`  cd ${dir}\n  pnpm install\n`);
    }
    stdout.write(
      "  Then: Agents → Install external agent → pick this folder.\n"
    );
  } catch (e) {
    stderr(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  }
}

function stderr(s) {
  process.stderr.write(s);
}

main().catch((e) => {
  stderr(`fatal: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exitCode = 1;
});
