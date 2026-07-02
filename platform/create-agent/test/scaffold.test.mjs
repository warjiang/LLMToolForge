// Unit tests for the create-llmtf-agent scaffolder. Scaffolds both templates
// into a temp dir and asserts structure + that generated manifests parse and
// match the AAP manifest contract the Rust host expects.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  scaffold,
  writeFiles,
  normalizeId,
  FRAMEWORKS,
} from "../src/scaffold.mjs";

const execFileP = promisify(execFile);
const results = [];
function ok(name) {
  results.push(`PASS: ${name}`);
}

async function testNormalizeId() {
  assert.equal(normalizeId("My Cool Agent!!"), "my-cool-agent");
  assert.equal(normalizeId("  --Weird__Name--  "), "weird-name");
  assert.throws(() => normalizeId("***"), /empty/);
  ok("normalizeId");
}

function assertManifest(json, expected) {
  const m = JSON.parse(json);
  // Mirror the Rust RawManifest required-field contract.
  for (const key of ["id", "name", "runtime", "entry"]) {
    assert.ok(m[key] && typeof m[key] === "string", `manifest.${key} present`);
  }
  assert.equal(m.runtime, expected.runtime);
  assert.equal(m.entry, expected.entry);
  assert.equal(m.framework, expected.framework);
  assert.equal(m.version, "0.1.0");
  assert.ok(m.defaults && typeof m.defaults === "object");
}

async function testScaffoldPython() {
  const { runtime, files } = scaffold({
    id: "My Py Agent",
    framework: "langgraph",
  });
  assert.equal(runtime, "python");
  for (const f of ["agent.json", "main.py", "pyproject.toml", "README.md", ".gitignore"]) {
    assert.ok(files[f], `python scaffold has ${f}`);
  }
  assertManifest(files["agent.json"], {
    runtime: "python",
    entry: "main.py",
    framework: "langgraph",
  });
  assert.match(files["main.py"], /host_tools_for_langchain/);
  assert.match(files["main.py"], /run\(on_prompt, name="my-py-agent"\)/);
  assert.match(files["pyproject.toml"], /name = "my-py-agent"/);
  // Without sdkPath: no local path source.
  assert.doesNotMatch(files["pyproject.toml"], /tool\.uv\.sources/);
  ok("scaffold python (langgraph)");
}

async function testScaffoldNode() {
  const { runtime, files } = scaffold({
    id: "my-node-agent",
    framework: "vercel-ai",
  });
  assert.equal(runtime, "node");
  for (const f of ["agent.json", "main.mjs", "package.json", "README.md", ".gitignore"]) {
    assert.ok(files[f], `node scaffold has ${f}`);
  }
  assertManifest(files["agent.json"], {
    runtime: "node",
    entry: "main.mjs",
    framework: "vercel-ai",
  });
  assert.match(files["main.mjs"], /hostToolsForVercel/);
  const pkg = JSON.parse(files["package.json"]);
  assert.equal(pkg.name, "my-node-agent");
  assert.equal(pkg.dependencies["@llmtoolforge/agent-sdk"], "^0.1.0");
  ok("scaffold node (vercel-ai)");
}

async function testSdkPathWiring() {
  const py = scaffold({ id: "p", framework: "langgraph", sdkPath: "/abs/sdk/py" });
  assert.match(py.files["pyproject.toml"], /\[tool\.uv\.sources\]/);
  assert.match(py.files["pyproject.toml"], /path = "\/abs\/sdk\/py"/);

  const node = scaffold({ id: "n", framework: "vercel-ai", sdkPath: "/abs/sdk/node" });
  const pkg = JSON.parse(node.files["package.json"]);
  assert.equal(pkg.dependencies["@llmtoolforge/agent-sdk"], "file:/abs/sdk/node");
  ok("sdk-path wiring");
}

async function testWriteFilesAndOverwriteGuard() {
  const dir = await mkdtemp(join(tmpdir(), "llmtf-scaffold-"));
  try {
    const { files } = scaffold({ id: "guarded", framework: "vercel-ai" });
    const written = await writeFiles(dir, files);
    assert.deepEqual(new Set(written), new Set(Object.keys(files)));
    // Re-write without force must throw.
    await assert.rejects(() => writeFiles(dir, files), /refusing to overwrite/);
    // With force it succeeds.
    await writeFiles(dir, files, { force: true });
    const written2 = await readFile(join(dir, "agent.json"), "utf8");
    JSON.parse(written2); // still valid
    ok("writeFiles + overwrite guard");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function testUnknownFramework() {
  assert.throws(() => scaffold({ id: "x", framework: "autogen" }), /unknown framework/);
  ok("unknown framework rejected");
}

async function testCliEndToEnd() {
  const dir = await mkdtemp(join(tmpdir(), "llmtf-cli-"));
  const bin = new URL("../bin/create-llmtf-agent.mjs", import.meta.url).pathname;
  try {
    const out = join(dir, "cli-agent");
    const { stdout } = await execFileP(process.execPath, [
      bin,
      out,
      "--framework",
      "vercel-ai",
      "--id",
      "cli-agent",
    ]);
    assert.match(stdout, /Scaffolded vercel-ai agent "cli-agent"/);
    const manifest = JSON.parse(await readFile(join(out, "agent.json"), "utf8"));
    assert.equal(manifest.id, "cli-agent");
    assert.equal(manifest.runtime, "node");
    ok("cli end-to-end (vercel-ai)");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  assert.deepEqual(Object.keys(FRAMEWORKS).sort(), ["langgraph", "vercel-ai"]);
  await testNormalizeId();
  await testScaffoldPython();
  await testScaffoldNode();
  await testSdkPathWiring();
  await testWriteFilesAndOverwriteGuard();
  await testUnknownFramework();
  await testCliEndToEnd();
  for (const r of results) console.log(r);
  console.log("ALL create-llmtf-agent TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
