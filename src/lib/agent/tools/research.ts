/**
 * ResearchAgent tools — a deep integration layer over the vendored Python
 * research-harness (`sidecar/research-harness`).
 *
 * Instead of having the model assemble raw `cd $HARNESS && python3 -m
 * research_harness ...` bash strings against a hardcoded path, these tools:
 *
 * - resolve the harness root + a compatible Python at runtime via the Tauri
 *   `resolve_research_harness_root` command (portable across machines), and
 * - run each pipeline stage with structured, validated arguments, returning a
 *   structured result (exit code, stdout/stderr, and — when a delta collection
 *   is blocked — the parsed channel diagnosis), so a blocked channel (e.g.
 *   reddit) can be inspected / skipped / retried instead of dying on
 *   "Delta collection blocked ... exit code 2".
 */

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { InternalToolDeps } from "./internal";
import { invoke, textResult } from "./shared";

/** Resolved harness location + Python preflight from the Rust side. */
export interface ResearchHarnessInfo {
  root: string;
  python: string | null;
  pythonVersion: string | null;
  ready: boolean;
  error: string | null;
}

interface SandboxRunResponse {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  sandboxBackend: string;
}

interface FsReadResponse {
  path: string;
  content: string;
  truncated: boolean;
  lineCount: number;
}

/** Internal tool ids contributed by this module. */
export const RESEARCH_TOOL_IDS = [
  "research_harness",
  "research_channel_diagnosis",
] as const;

let harnessPromise: Promise<ResearchHarnessInfo> | null = null;

/**
 * Resolve (and cache) the vendored harness location + Python preflight.
 * Cached because it shells out to detect Python; pass `force` to re-check.
 */
export async function resolveHarness(force = false): Promise<ResearchHarnessInfo> {
  if (force || !harnessPromise) {
    harnessPromise = invoke<ResearchHarnessInfo>(
      "resolve_research_harness_root",
      {}
    ).catch((err) => {
      harnessPromise = null;
      throw err;
    });
  }
  return harnessPromise;
}

const HARNESS_COMMANDS = [
  "init",
  "new-scenario",
  "ingest",
  "normalize",
  "audit",
  "analyze",
  "publish-notion",
  "delta-plan",
  "approve-delta",
  "collect-delta",
  "ingest-delta",
  "report-delta",
] as const;
type HarnessCommand = (typeof HARNESS_COMMANDS)[number];

const INGEST_FORMATS = [
  "evidence-list",
  "xhs-search",
  "xhs-detail",
  "xhs-comments",
] as const;

function goalParam() {
  return Type.Optional(
    Type.String({
      description:
        "Concise user-visible goal for this tool call. Explain why this step is needed.",
    })
  );
}

const harnessParams = Type.Object({
  goal: goalParam(),
  command: Type.Union(
    HARNESS_COMMANDS.map((c) => Type.Literal(c)),
    {
      description:
        "Harness pipeline stage to run. Protected stages (collect/ingest/normalize/audit/analyze/publish) require checkpoint approval.",
    }
  ),
  scenario: Type.Optional(
    Type.String({
      description: "Scenario id (positional scenario_id for most commands).",
    })
  ),
  batchId: Type.Optional(
    Type.String({ description: "Delta batch id (--batch-id)." })
  ),
  channel: Type.Optional(
    Type.String({ description: "Channel id (--channel), e.g. reddit." })
  ),
  input: Type.Optional(
    Type.String({ description: "Input file path for `ingest` (--input)." })
  ),
  format: Type.Optional(
    Type.Union(INGEST_FORMATS.map((f) => Type.Literal(f)), {
      description: "Source format for `ingest` (--format).",
    })
  ),
  runId: Type.Optional(Type.String({ description: "Run id (--run-id)." })),
  name: Type.Optional(
    Type.String({ description: "Scenario display name for `new-scenario`." })
  ),
  description: Type.Optional(
    Type.String({ description: "Scenario description for `new-scenario`." })
  ),
  targetUsers: Type.Optional(Type.Array(Type.String())),
  validationTargets: Type.Optional(Type.Array(Type.String())),
  hypotheses: Type.Optional(Type.Array(Type.String())),
  channels: Type.Optional(
    Type.Array(Type.String(), {
      description: "Channel list for `new-scenario` (--channel, repeatable).",
    })
  ),
  keywords: Type.Optional(
    Type.Array(Type.String(), {
      description: "Seed keywords for `new-scenario` (--keyword, repeatable).",
    })
  ),
  deltaKeywords: Type.Optional(
    Type.Array(Type.String(), {
      description: "Delta keywords for `ingest` (--delta-keyword, repeatable).",
    })
  ),
  approvedBy: Type.Optional(
    Type.String({ description: "Approver for `approve-delta` (--approved-by)." })
  ),
  note: Type.Optional(Type.String({ description: "Approval note (--note)." })),
  onlyChannels: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Restrict `collect-delta` to these channels (--only-channel). Use to retry one blocked channel.",
    })
  ),
  skipChannels: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Skip these channels for `collect-delta`/`ingest-delta` (--skip-channel). Use to continue past a blocked channel.",
    })
  ),
  page: Type.Optional(
    Type.String({ description: "Notion page id for `publish-notion` (--page)." })
  ),
  source: Type.Optional(
    Type.String({
      description: "Markdown source path for `publish-notion` (--source).",
    })
  ),
  token: Type.Optional(
    Type.String({ description: "Notion token override (--token)." })
  ),
  dryRun: Type.Optional(
    Type.Boolean({ description: "Add --dry-run where supported." })
  ),
  timeoutMs: Type.Optional(
    Type.Number({ description: "Command timeout in ms (1000-120000)." })
  ),
});

type HarnessParams = {
  command: HarnessCommand;
  scenario?: string;
  batchId?: string;
  channel?: string;
  input?: string;
  format?: (typeof INGEST_FORMATS)[number];
  runId?: string;
  name?: string;
  description?: string;
  targetUsers?: string[];
  validationTargets?: string[];
  hypotheses?: string[];
  channels?: string[];
  keywords?: string[];
  deltaKeywords?: string[];
  approvedBy?: string;
  note?: string;
  onlyChannels?: string[];
  skipChannels?: string[];
  page?: string;
  source?: string;
  token?: string;
  dryRun?: boolean;
  timeoutMs?: number;
};

function repeated(flag: string, values?: string[]): string[] {
  return (values ?? []).flatMap((v) => [flag, v]);
}

/** Build the `python -m research_harness` argv (after `-m research_harness`). */
function buildHarnessArgs(p: HarnessParams, sessionRoot: string): string[] {
  const args = ["-m", "research_harness", "--root", sessionRoot, p.command];
  const needScenario = (label: string) => {
    if (!p.scenario?.trim()) {
      throw new Error(`命令 ${label} 需要 scenario`);
    }
    args.push(p.scenario.trim());
  };
  const needBatch = (label: string) => {
    if (!p.batchId?.trim()) {
      throw new Error(`命令 ${label} 需要 batchId`);
    }
    args.push("--batch-id", p.batchId.trim());
  };

  switch (p.command) {
    case "init":
      break;
    case "new-scenario":
      needScenario("new-scenario");
      if (p.name) args.push("--name", p.name);
      if (p.description) args.push("--description", p.description);
      args.push(...repeated("--target-user", p.targetUsers));
      args.push(...repeated("--validation-target", p.validationTargets));
      args.push(...repeated("--hypothesis", p.hypotheses));
      args.push(...repeated("--channel", p.channels));
      args.push(...repeated("--keyword", p.keywords));
      break;
    case "ingest":
      needScenario("ingest");
      if (!p.channel?.trim()) throw new Error("ingest 需要 channel");
      if (!p.input?.trim()) throw new Error("ingest 需要 input");
      if (!p.format) throw new Error("ingest 需要 format");
      args.push("--channel", p.channel.trim());
      args.push("--input", p.input.trim());
      args.push("--format", p.format);
      if (p.runId) args.push("--run-id", p.runId);
      if (p.batchId) args.push("--batch-id", p.batchId);
      args.push(...repeated("--delta-keyword", p.deltaKeywords));
      break;
    case "normalize":
      needScenario("normalize");
      if (p.channel) args.push("--channel", p.channel);
      if (p.batchId) args.push("--batch-id", p.batchId);
      break;
    case "audit":
    case "analyze":
      needScenario(p.command);
      break;
    case "publish-notion":
      needScenario("publish-notion");
      if (!p.page?.trim()) throw new Error("publish-notion 需要 page");
      if (!p.source?.trim()) throw new Error("publish-notion 需要 source");
      args.push("--page", p.page.trim(), "--source", p.source.trim());
      if (p.token) args.push("--token", p.token);
      if (p.dryRun) args.push("--dry-run");
      break;
    case "delta-plan":
    case "report-delta":
      needScenario(p.command);
      needBatch(p.command);
      break;
    case "approve-delta":
      needScenario("approve-delta");
      needBatch("approve-delta");
      if (!p.approvedBy?.trim()) throw new Error("approve-delta 需要 approvedBy");
      args.push("--approved-by", p.approvedBy.trim());
      if (p.note) args.push("--note", p.note);
      break;
    case "collect-delta":
      needScenario("collect-delta");
      needBatch("collect-delta");
      if (p.dryRun) args.push("--dry-run");
      args.push(...repeated("--only-channel", p.onlyChannels));
      args.push(...repeated("--skip-channel", p.skipChannels));
      break;
    case "ingest-delta":
      needScenario("ingest-delta");
      needBatch("ingest-delta");
      args.push(...repeated("--skip-channel", p.skipChannels));
      break;
    default: {
      const exhaustive: never = p.command;
      throw new Error(`未知命令: ${String(exhaustive)}`);
    }
  }
  return args;
}

const BLOCKED_RE = /Delta collection blocked at `([^`]+)`/;

/**
 * The harness prints the absolute diagnosis path in its output, e.g.
 * `诊断文件通常在 /private/tmp/.../reddit.diagnosis.md` (delta.py) or
 * `诊断文件：/private/tmp/.../reddit.diagnosis.md` (collection_guard). Parsing it
 * straight from the output is the most reliable way to locate the sidecar.
 */
const DIAG_PATH_RE = /诊断文件(?:通常在|[:：])\s*(\S+\.diagnosis\.(?:md|json))/;

async function readJsonFile(path: string): Promise<unknown | null> {
  try {
    const res = await invoke<FsReadResponse>("fs_read", {
      req: { path, sandboxMode: "read-only", workspaceRoot: "" },
    });
    return JSON.parse(res.content);
  } catch {
    return null;
  }
}

/** Pull diagnosis sidecar paths out of harness stdout/stderr, JSON first. */
function diagnosisPathsFromOutput(output: string): string[] {
  const m = DIAG_PATH_RE.exec(output);
  if (!m) return [];
  const matched = m[1];
  const jsonPath = matched.replace(/\.diagnosis\.md$/, ".diagnosis.json");
  const mdPath = matched.replace(/\.diagnosis\.json$/, ".diagnosis.md");
  return Array.from(new Set([jsonPath, mdPath]));
}

/**
 * Reconstruct candidate diagnosis paths when the output didn't carry one.
 *
 * Delta collectors stage their output (and `.diagnosis.{json,md}` sidecars)
 * under a FIXED tmp base, not under the session `--root` — this mirrors
 * `delta.py:_delta_base_dir = /private/tmp/research-harness/<scenario>/<batch>`.
 * The sidecar stem is the collector id, which equals the channel for most
 * channels but differs for appstore (`appstore-itunes` / `appstore-android-markets`).
 */
function diagnosisCandidatePaths(
  scenario: string,
  batchId: string,
  channelOrId: string
): string[] {
  const bases = [
    `/private/tmp/research-harness/${scenario}/${batchId}`,
    `/tmp/research-harness/${scenario}/${batchId}`,
  ];
  const stems = [channelOrId];
  if (channelOrId === "appstore") {
    stems.push("appstore-itunes", "appstore-android-markets");
  }
  const paths: string[] = [];
  for (const base of bases) {
    for (const stem of stems) {
      paths.push(`${base}/${stem}.diagnosis.json`);
      paths.push(`${base}/${stem}.diagnosis.md`);
    }
  }
  return paths;
}

function harnessTool(deps: InternalToolDeps): AgentTool {
  return {
    name: "research_harness",
    label: "Research harness",
    description:
      "Run a single stage of the built-in research-harness pipeline with " +
      "structured arguments (no hardcoded path, no raw shell). On a blocked " +
      "delta collection the result includes the parsed channel diagnosis.",
    parameters: harnessParams,
    execute: async (_id: string, params: HarnessParams) => {
      const sessionRoot = deps.workspaceRoot.trim();
      if (!sessionRoot) {
        throw new Error(
          "ResearchAgent 需要一个会话工作区作为 --root；请先设置工作区路径。"
        );
      }
      const harness = await resolveHarness();
      if (!harness.ready || !harness.python || !harness.root) {
        throw new Error(
          harness.error ||
            "内置 research-harness 不可用（缺少 harness 目录或兼容的 Python）。"
        );
      }
      const args = buildHarnessArgs(params, sessionRoot);
      const res = await invoke<SandboxRunResponse>("run_sandboxed_command", {
        req: {
          command: harness.python,
          args,
          // Run from the session root so workspace-write sandboxing permits the
          // harness's writes under --root; reach the package via PYTHONPATH.
          cwd: sessionRoot,
          env: { PYTHONPATH: harness.root },
          sandboxMode: deps.sandboxMode,
          timeoutMs: params.timeoutMs ?? 120000,
        },
      });

      const parts: string[] = [];
      if (res.stdout) parts.push(res.stdout);
      if (res.stderr) parts.push(`[stderr]\n${res.stderr}`);
      if (res.timedOut) parts.push("[超时] 命令被终止");
      parts.push(`[exit ${res.exitCode ?? "null"}]`);

      const combined = `${res.stdout}\n${res.stderr}`;
      const blocked = res.exitCode !== 0 && BLOCKED_RE.test(combined);
      let diagnosis: unknown = null;
      let blockedChannel: string | null = null;
      if (blocked) {
        // The error names the blocked collector id (e.g. reddit, appstore-itunes).
        blockedChannel = BLOCKED_RE.exec(combined)?.[1] ?? null;
        // Prefer the absolute path printed in the output; fall back to the known
        // tmp staging layout keyed by the blocked id.
        const candidatePaths = [
          ...diagnosisPathsFromOutput(combined),
          ...(blockedChannel && params.batchId && params.scenario
            ? diagnosisCandidatePaths(
                params.scenario,
                params.batchId,
                blockedChannel
              )
            : []),
        ];
        for (const path of candidatePaths) {
          const parsed = await readJsonFile(path);
          if (parsed) {
            diagnosis = parsed;
            break;
          }
        }
        parts.push(
          `\n[blocked] 渠道 \`${blockedChannel ?? "?"}\` 采集被阻断。` +
            "可用 research_channel_diagnosis 查看诊断，" +
            "或用 collect-delta --only-channel 重试 / --skip-channel 跳过后继续。"
        );
        if (diagnosis) {
          parts.push(`[diagnosis]\n${JSON.stringify(diagnosis, null, 2)}`);
        }
      }

      const out = parts.join("\n").trim();
      return textResult(out || "(无输出)", {
        ...res,
        command: params.command,
        blocked,
        blockedChannel,
        diagnosis,
      }) as AgentToolResult<unknown>;
    },
  } as unknown as AgentTool;
}

function channelDiagnosisTool(_deps: InternalToolDeps): AgentTool {
  return {
    name: "research_channel_diagnosis",
    label: "Channel diagnosis",
    description:
      "Read the harness collection diagnosis for a blocked channel (e.g. " +
      "reddit) and return its structured cause + next action so you can " +
      "decide to retry or skip it.",
    parameters: Type.Object({
      goal: goalParam(),
      scenario: Type.String({ description: "Scenario id." }),
      batchId: Type.String({ description: "Delta batch id." }),
      channel: Type.String({
        description:
          "Blocked channel or collector id, e.g. reddit (for appstore use appstore-itunes / appstore-android-markets).",
      }),
    }),
    execute: async (
      _id: string,
      params: { scenario: string; batchId: string; channel: string }
    ) => {
      // Diagnosis sidecars are staged under the harness tmp base, not the
      // session root, so no workspace root is required to read them.
      const candidates = diagnosisCandidatePaths(
        params.scenario,
        params.batchId,
        params.channel
      );
      for (const path of candidates) {
        if (path.endsWith(".json")) {
          const parsed = await readJsonFile(path);
          if (parsed) {
            return textResult(JSON.stringify(parsed, null, 2), {
              path,
              diagnosis: parsed,
            }) as AgentToolResult<unknown>;
          }
        } else {
          try {
            const res = await invoke<FsReadResponse>("fs_read", {
              req: { path, sandboxMode: "read-only", workspaceRoot: "" },
            });
            return textResult(res.content, {
              path,
              diagnosis: null,
            }) as AgentToolResult<unknown>;
          } catch {
            // try next candidate
          }
        }
      }
      return textResult(
        `未找到 \`${params.channel}\` 的诊断文件（已尝试：\n${candidates.join("\n")}）。` +
          "可能该渠道尚未采集或未被阻断。",
        { path: null, diagnosis: null }
      ) as AgentToolResult<unknown>;
    },
  } as unknown as AgentTool;
}

/** Build the ResearchAgent harness tools. */
export const RESEARCH_TOOL_BUILDERS: Record<
  (typeof RESEARCH_TOOL_IDS)[number],
  (deps: InternalToolDeps) => AgentTool
> = {
  research_harness: harnessTool,
  research_channel_diagnosis: channelDiagnosisTool,
};

