/**
 * Internal agent tools backed by Tauri commands.
 *
 * - `bash`  → `run_sandboxed_command`
 * - `read` / `write` / `edit` / `ls` / `grep` → `fs_*` commands
 *
 * All tools honour the active sandbox mode. Relative paths resolve under the
 * configured execution root, or under the backend's managed temporary sandbox
 * directory when no workspace was selected.
 * Tools throw on failure (Pi convention) so the loop records an error result.
 */

import { Type } from "@earendil-works/pi-ai";
import type { Static, TSchema } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { SandboxMode } from "@/types/chat";
import type { AgentInternalToolId } from "@/types";
import { invoke, textResult } from "./shared";

export type InternalToolId = AgentInternalToolId;

/** Identity helper that preserves TypeBox param inference for `execute`. */
function defineTool<P extends TSchema>(def: {
  name: string;
  label: string;
  description: string;
  parameters: P;
  execute: (
    id: string,
    params: Static<P>,
    signal?: AbortSignal
  ) => Promise<AgentToolResult<unknown>>;
  executionMode?: AgentTool["executionMode"];
}): AgentTool {
  return def as unknown as AgentTool;
}

function goalParam(): TSchema {
  return Type.Optional(
    Type.String({
      description:
        "Concise user-visible goal for this tool call. Explain why this step is needed, not just what the tool is.",
    })
  );
}

export const INTERNAL_TOOL_IDS: InternalToolId[] = [
  "checkpoint",
  "ask_human",
  "bash",
  "read",
  "write",
  "edit",
  "ls",
  "grep",
  "duckdb_query",
  "data_chart_html",
  "data_report_html",
  "web_fetch",
];

export interface InternalToolDeps {
  sandboxMode: SandboxMode;
  /** Absolute execution root. Empty means the backend uses its managed sandbox dir. */
  workspaceRoot: string;
  requestCheckpoint?: RequestCheckpoint;
  requestAsk?: RequestAsk;
}

export interface CheckpointRequest {
  toolCallId: string;
  title: string;
  summary: string;
  proposedAction: string;
  risk?: string;
  artifacts?: string[];
}

export interface CheckpointDecision {
  approved: boolean;
  note?: string;
  decidedAt: string;
}

export type RequestCheckpoint = (
  request: CheckpointRequest,
  signal?: AbortSignal
) => Promise<CheckpointDecision>;

/** The interaction shape an `ask_human` request renders. */
export type AskHumanKind = "confirm" | "select" | "form";

/** A single question inside a `form`-kind ask_human request. */
export interface AskHumanField {
  id: string;
  label: string;
  type: "text" | "select" | "confirm";
  options?: string[];
  placeholder?: string;
}

export interface AskHumanRequest {
  toolCallId: string;
  kind: AskHumanKind;
  title: string;
  /** Question / context shown to the user. */
  message?: string;
  /** confirm: button labels. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** select: the single-choice options. */
  options?: string[];
  /** form: the combined questions. */
  fields?: AskHumanField[];
}

export interface AskHumanResponse {
  kind: AskHumanKind;
  /** True when the user dismissed without answering (agent should adapt/stop). */
  cancelled: boolean;
  /** confirm: whether the user confirmed (vs. chose cancel). */
  confirmed?: boolean;
  /** select: the chosen option. */
  selected?: string;
  /** form: answers keyed by field id. */
  answers?: Record<string, string>;
  decidedAt: string;
}

export type RequestAsk = (
  request: AskHumanRequest,
  signal?: AbortSignal
) => Promise<AskHumanResponse>;

interface SandboxRunResponse {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  sandboxBackend: string;
}

function checkpointTool(deps: InternalToolDeps): AgentTool {
  return defineTool({
    name: "checkpoint",
    label: "Checkpoint",
    description:
      "Pause the agent and request explicit human approval before a protected action. " +
      "Use before collection, import, normalize, audit, analyze, publish, or commit steps.",
    parameters: Type.Object({
      goal: goalParam(),
      title: Type.String({
        description: "Short approval title shown to the human.",
      }),
      summary: Type.String({
        description: "What has been prepared and why approval is needed.",
      }),
      proposedAction: Type.String({
        description: "The exact action the agent wants to perform next.",
      }),
      risk: Type.Optional(
        Type.String({
          description: "Main risk or consequence if the action proceeds.",
        })
      ),
      artifacts: Type.Optional(
        Type.Array(
          Type.String({
            description: "Relevant files, commands, channels, or outputs.",
          })
        )
      ),
    }),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      if (!deps.requestCheckpoint) {
        throw new Error("Checkpoint approval UI is not available");
      }
      const decision = await deps.requestCheckpoint(
        {
          toolCallId,
          title: params.title,
          summary: params.summary,
          proposedAction: params.proposedAction,
          risk: params.risk,
          artifacts: params.artifacts,
        },
        signal
      );
      return textResult(
        decision.approved
          ? `Checkpoint approved${decision.note ? `: ${decision.note}` : ""}`
          : `Checkpoint rejected${decision.note ? `: ${decision.note}` : ""}`,
        decision
      );
    },
  });
}

function askHumanTool(deps: InternalToolDeps): AgentTool {
  const fieldSchema = Type.Object({
    id: Type.String({
      description: "Stable field id; becomes the key in the returned answers.",
    }),
    label: Type.String({ description: "Question text shown to the user." }),
    type: Type.Union(
      [Type.Literal("text"), Type.Literal("select"), Type.Literal("confirm")],
      {
        description:
          "Input type: 'text' free text, 'select' single choice, 'confirm' yes/no.",
      }
    ),
    options: Type.Optional(
      Type.Array(Type.String(), {
        description: "Choices for a 'select' field (required when type=select).",
      })
    ),
    placeholder: Type.Optional(
      Type.String({ description: "Placeholder hint for a 'text' field." })
    ),
  });
  return defineTool({
    name: "ask_human",
    label: "Ask human",
    description:
      "Ask the user for input mid-run and wait for a structured answer. " +
      "kind='confirm' shows a confirm/cancel prompt; kind='select' shows a " +
      "single-choice list (provide options); kind='form' shows several " +
      "questions at once (provide fields). Use it to resolve scope, pick a " +
      "direction, or gather missing parameters instead of guessing.",
    parameters: Type.Object({
      goal: goalParam(),
      kind: Type.Union(
        [Type.Literal("confirm"), Type.Literal("select"), Type.Literal("form")],
        {
          description:
            "Interaction form: 'confirm' (yes/no), 'select' (pick one of options), or 'form' (multiple questions).",
        }
      ),
      title: Type.String({ description: "Short title for the prompt card." }),
      message: Type.Optional(
        Type.String({
          description:
            "The question or context shown to the user (used by confirm/select; optional intro for form).",
        })
      ),
      confirmLabel: Type.Optional(
        Type.String({ description: "Confirm button label (kind=confirm)." })
      ),
      cancelLabel: Type.Optional(
        Type.String({ description: "Cancel button label (kind=confirm)." })
      ),
      options: Type.Optional(
        Type.Array(Type.String(), {
          description: "Single-choice options (kind=select, need >= 2).",
        })
      ),
      fields: Type.Optional(
        Type.Array(fieldSchema, {
          description: "The combined questions to ask (kind=form).",
        })
      ),
    }),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      if (!deps.requestAsk) {
        throw new Error("Human input UI is not available");
      }
      if (params.kind === "select") {
        if (!params.options || params.options.length < 2) {
          throw new Error("ask_human kind=select requires at least 2 options");
        }
      }
      if (params.kind === "form") {
        if (!params.fields || params.fields.length === 0) {
          throw new Error("ask_human kind=form requires at least one field");
        }
        for (const f of params.fields) {
          if (f.type === "select" && (!f.options || f.options.length < 2)) {
            throw new Error(
              `ask_human form field "${f.id}" is select but has < 2 options`
            );
          }
        }
      }
      const response = await deps.requestAsk(
        {
          toolCallId,
          kind: params.kind,
          title: params.title,
          message: params.message,
          confirmLabel: params.confirmLabel,
          cancelLabel: params.cancelLabel,
          options: params.options,
          fields: params.fields,
        },
        signal
      );

      let text: string;
      if (response.cancelled) {
        text = "User dismissed the prompt without answering.";
      } else if (response.kind === "confirm") {
        text = response.confirmed
          ? "User confirmed."
          : "User chose cancel (declined).";
      } else if (response.kind === "select") {
        text = `User selected: ${response.selected ?? "(none)"}`;
      } else {
        const lines = Object.entries(response.answers ?? {}).map(
          ([k, v]) => `- ${k}: ${v}`
        );
        text = `User answers:\n${lines.join("\n") || "(none)"}`;
      }
      return textResult(text, response);
    },
  });
}

function bashTool(deps: InternalToolDeps): AgentTool {
  return defineTool({
    name: "bash",
    label: "Bash",
    description:
      "Run a shell command via bash inside the sandbox. Use for builds, git, " +
      "and any task not covered by the dedicated file tools.",
    parameters: Type.Object({
      goal: goalParam(),
      command: Type.String({ description: "The shell command to execute." }),
      timeoutMs: Type.Optional(
        Type.Number({ description: "Timeout in ms (1000-120000)." })
      ),
    }),
    execute: async (_id, params) => {
      const res = await invoke<SandboxRunResponse>("run_sandboxed_command", {
        req: {
          command: "bash",
          args: ["-lc", params.command],
          cwd: deps.workspaceRoot.trim() || undefined,
          sandboxMode: deps.sandboxMode,
          timeoutMs: params.timeoutMs,
        },
      });
      const parts: string[] = [];
      if (res.stdout) parts.push(res.stdout);
      if (res.stderr) parts.push(`[stderr]\n${res.stderr}`);
      if (res.timedOut) parts.push("[超时] 命令被终止");
      parts.push(`[exit ${res.exitCode ?? "null"}]`);
      const out = parts.join("\n").trim();
      return textResult(out || "(无输出)", res);
    },
  });
}

interface FsReadResponse {
  path: string;
  content: string;
  truncated: boolean;
  lineCount: number;
}

function readTool(deps: InternalToolDeps): AgentTool {
  return defineTool({
    name: "read",
    label: "Read file",
    description: "Read a UTF-8 text file. Optionally start at a 1-based line offset.",
    parameters: Type.Object({
      goal: goalParam(),
      path: Type.String({
        description: "File path (absolute or relative to the execution root).",
      }),
      offset: Type.Optional(Type.Number({ description: "1-based start line." })),
      limit: Type.Optional(Type.Number({ description: "Max lines to return." })),
    }),
    execute: async (_id, params) => {
      const res = await invoke<FsReadResponse>("fs_read", {
        req: {
          workspaceRoot: deps.workspaceRoot.trim(),
          path: params.path,
          sandboxMode: deps.sandboxMode,
          offset: params.offset,
          limit: params.limit,
        },
      });
      const suffix = res.truncated ? "\n…(内容已截断)" : "";
      return textResult(res.content + suffix, res);
    },
  });
}

interface FsWriteResponse {
  path: string;
  bytesWritten: number;
}

function writeTool(deps: InternalToolDeps): AgentTool {
  return defineTool({
    name: "write",
    label: "Write file",
    description:
      "Create or overwrite a text file. Denied in read-only sandbox; in " +
      "workspace-write the path must stay inside the execution root or temp.",
    parameters: Type.Object({
      goal: goalParam(),
      path: Type.String({
        description: "File path (absolute or relative to the execution root).",
      }),
      content: Type.String({ description: "Full file content to write." }),
    }),
    execute: async (_id, params) => {
      const res = await invoke<FsWriteResponse>("fs_write", {
        req: {
          workspaceRoot: deps.workspaceRoot.trim(),
          path: params.path,
          content: params.content,
          sandboxMode: deps.sandboxMode,
        },
      });
      return textResult(`已写入 ${res.path} (${res.bytesWritten} 字节)`, res);
    },
  });
}

interface FsEditResponse {
  path: string;
  replaced: number;
}

function editTool(deps: InternalToolDeps): AgentTool {
  return defineTool({
    name: "edit",
    label: "Edit file",
    description:
      "Replace an exact string in a file. Fails if oldStr is missing or matches " +
      "more than once (unless replaceAll is set).",
    parameters: Type.Object({
      goal: goalParam(),
      path: Type.String({
        description: "File path (absolute or relative to the execution root).",
      }),
      oldStr: Type.String({ description: "Exact text to replace." }),
      newStr: Type.String({ description: "Replacement text." }),
      replaceAll: Type.Optional(
        Type.Boolean({ description: "Replace every occurrence." })
      ),
    }),
    execute: async (_id, params) => {
      const res = await invoke<FsEditResponse>("fs_edit", {
        req: {
          workspaceRoot: deps.workspaceRoot.trim(),
          path: params.path,
          oldStr: params.oldStr,
          newStr: params.newStr,
          replaceAll: params.replaceAll,
          sandboxMode: deps.sandboxMode,
        },
      });
      return textResult(`已更新 ${res.path}（替换 ${res.replaced} 处）`, res);
    },
  });
}

interface FsListEntry {
  name: string;
  kind: string;
  size: number;
}
interface FsListResponse {
  path: string;
  entries: FsListEntry[];
}

function lsTool(deps: InternalToolDeps): AgentTool {
  return defineTool({
    name: "ls",
    label: "List directory",
    description: "List the entries of a directory.",
    parameters: Type.Object({
      goal: goalParam(),
      path: Type.Optional(
        Type.String({
          description: "Directory path. Defaults to the current execution root.",
        })
      ),
    }),
    execute: async (_id, params) => {
      const res = await invoke<FsListResponse>("fs_list", {
        req: {
          workspaceRoot: deps.workspaceRoot.trim(),
          path: params.path,
          sandboxMode: deps.sandboxMode,
        },
      });
      const lines = res.entries.map((e) =>
        e.kind === "dir" ? `${e.name}/` : `${e.name} (${e.size}B)`
      );
      return textResult(
        `${res.path}\n${lines.join("\n") || "(空目录)"}`,
        res
      );
    },
  });
}

interface FsGrepMatch {
  path: string;
  line: number;
  text: string;
}
interface FsGrepResponse {
  matches: FsGrepMatch[];
  truncated: boolean;
}

const dataSourceSchema = Type.Object({
  path: Type.String({
    description: "Local data file path, absolute or workspace-relative.",
  }),
  alias: Type.Optional(
    Type.String({
      description:
        "Optional SQL table alias. Defaults to a safe name derived from the file name.",
    })
  ),
  format: Type.Optional(
    Type.String({
      description: "Optional source format: csv, tsv, json, jsonl, or parquet.",
    })
  ),
});

interface DataSourceParam {
  path: string;
  alias?: string;
  format?: string;
}

interface DuckDbQueryResponse {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
  sources: { alias: string; path: string; format: string }[];
}

interface DataChartHtmlResponse extends DuckDbQueryResponse {
  outputPath: string;
  outputDir: string;
  chartType: string;
  title: string;
}

interface DataReportHtmlResponse {
  outputPath: string;
  outputDir: string;
  title: string;
  sectionCount: number;
  durationMs: number;
}

function grepTool(deps: InternalToolDeps): AgentTool {
  return defineTool({
    name: "grep",
    label: "Grep",
    description:
      "Search file contents with a regular expression, recursively under a path.",
    parameters: Type.Object({
      goal: goalParam(),
      pattern: Type.String({ description: "Regular expression to search for." }),
      path: Type.Optional(
        Type.String({
          description: "Root path to search. Defaults to the current execution root.",
        })
      ),
      ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive." })),
      maxResults: Type.Optional(Type.Number({ description: "Cap on matches." })),
    }),
    execute: async (_id, params) => {
      const res = await invoke<FsGrepResponse>("fs_grep", {
        req: {
          workspaceRoot: deps.workspaceRoot.trim(),
          pattern: params.pattern,
          path: params.path,
          ignoreCase: params.ignoreCase,
          maxResults: params.maxResults,
          sandboxMode: deps.sandboxMode,
        },
      });
      const lines = res.matches.map((m) => `${m.path}:${m.line}: ${m.text}`);
      const suffix = res.truncated ? "\n…(结果已截断)" : "";
      return textResult(
        (lines.join("\n") || "(无匹配)") + suffix,
        res
      );
    },
  });
}

function duckDbQueryTool(deps: InternalToolDeps): AgentTool {
  return defineTool({
    name: "duckdb_query",
    label: "DuckDB query",
    description:
      "Run a read-only DuckDB SELECT/WITH query over local CSV, TSV, JSON, JSONL, or Parquet files. " +
      "Provide sources with aliases, then query those aliases.",
    parameters: Type.Object({
      goal: goalParam(),
      sources: Type.Array(dataSourceSchema, {
        description: "Local data sources to register as DuckDB views.",
      }),
      sql: Type.String({
        description: "Read-only SQL starting with SELECT or WITH. Query source aliases, not file paths.",
      }),
      limit: Type.Optional(
        Type.Number({ description: "Preview row limit. Defaults to 200." })
      ),
    }),
    execute: async (_id, params) => {
      const res = await invoke<DuckDbQueryResponse>("duckdb_query", {
        req: {
          workspaceRoot: deps.workspaceRoot.trim(),
          sandboxMode: deps.sandboxMode,
          sources: params.sources as DataSourceParam[],
          sql: params.sql,
          limit: params.limit,
        },
      });
      const preview = JSON.stringify(res.rows, null, 2);
      return textResult(
        [
          `DuckDB query returned ${res.rowCount} rows across ${res.columns.length} columns.`,
          res.truncated ? `Preview truncated to ${res.rows.length} rows.` : "",
          `Columns: ${res.columns.join(", ") || "(none)"}`,
          preview,
        ]
          .filter(Boolean)
          .join("\n"),
        res
      );
    },
  });
}

function dataChartHtmlTool(deps: InternalToolDeps): AgentTool {
  return defineTool({
    name: "data_chart_html",
    label: "Data chart HTML",
    description:
      "Render an interactive ECharts chart as a small multi-file web app from a DuckDB query over local data files. The app is served locally and opens automatically in the built-in browser preview.",
    parameters: Type.Object({
      goal: goalParam(),
      sources: Type.Array(dataSourceSchema, {
        description: "Local data sources to register as DuckDB views.",
      }),
      sql: Type.String({ description: "Read-only SQL returning chart data." }),
      chartType: Type.String({
        description: "Chart type: bar, line, area, scatter, or pie.",
      }),
      x: Type.String({ description: "Column name to use for the x axis (category / name for pie)." }),
      y: Type.String({ description: "Numeric column name to use for the y axis (value for pie)." }),
      series: Type.Optional(
        Type.String({ description: "Optional column name for grouping series." })
      ),
      title: Type.Optional(Type.String({ description: "Chart title." })),
      outputPath: Type.Optional(
        Type.String({
          description:
            "Optional output directory. Defaults to dataagent-artifacts/chart-*/ in the workspace.",
        })
      ),
    }),
    execute: async (_id, params) => {
      const res = await invoke<DataChartHtmlResponse>("data_chart_html", {
        req: {
          workspaceRoot: deps.workspaceRoot.trim(),
          sandboxMode: deps.sandboxMode,
          sources: params.sources as DataSourceParam[],
          sql: params.sql,
          chartType: params.chartType,
          x: params.x,
          y: params.y,
          series: params.series,
          title: params.title,
          outputPath: params.outputPath,
        },
      });
      return textResult(
        `Created ${res.chartType} chart "${res.title}" at ${res.outputPath} from ${res.rowCount} rows.`,
        res
      );
    },
  });
}

function dataReportHtmlTool(deps: InternalToolDeps): AgentTool {
  return defineTool({
    name: "data_report_html",
    label: "Data report HTML",
    description:
      "Create an interactive multi-section report web app with text, optional tables, and embedded interactive ECharts charts. Served locally and opened automatically in the built-in browser preview.",
    parameters: Type.Object({
      goal: goalParam(),
      title: Type.String({ description: "Report title." }),
      sections: Type.Array(
        Type.Object({
          heading: Type.String({ description: "Section heading." }),
          text: Type.Optional(Type.String({ description: "Section narrative text. Supports lightweight inline formatting via a safe subset of HTML tags (b, strong, i, em, br, ul, ol, li, p, code); plain newlines also become line breaks. Do not use other tags or attributes - they render as plain text." })),
          chartPath: Type.Optional(
            Type.String({
              description:
                "Optional path to a chart produced by data_chart_html (its output directory or index.html) to embed inline.",
            })
          ),
          table: Type.Optional(
            Type.Object({
              columns: Type.Array(Type.String()),
              rows: Type.Array(Type.Array(Type.String())),
            })
          ),
        }),
        { description: "Report sections." }
      ),
      outputPath: Type.Optional(
        Type.String({
          description:
            "Optional output directory. Defaults to dataagent-artifacts/report-*/ in the workspace.",
        })
      ),
    }),
    execute: async (_id, params) => {
      const res = await invoke<DataReportHtmlResponse>("data_report_html", {
        req: {
          workspaceRoot: deps.workspaceRoot.trim(),
          sandboxMode: deps.sandboxMode,
          title: params.title,
          sections: params.sections,
          outputPath: params.outputPath,
        },
      });
      return textResult(
        `Created HTML report "${res.title}" with ${res.sectionCount} sections at ${res.outputPath}.`,
        res
      );
    },
  });
}

interface WebFetchLink {
  text: string;
  href: string;
}

interface WebFetchResponse {
  url: string;
  finalUrl: string;
  status: number;
  title: string;
  text: string;
  links: WebFetchLink[];
  truncated: boolean;
  mode: string;
}

function webFetchTool(_deps: InternalToolDeps): AgentTool {
  return defineTool({
    name: "web_fetch",
    label: "Fetch web page",
    description:
      "Fetch a public web page and return its readable text plus links. Use this to read the actual content of a search result, article, thread, or review page. Headless HTTP by default (no proxy or login). Set render=true for JavaScript-rendered or login-walled pages (e.g. zhihu, xiaohongshu, wechat): it loads the URL in the in-app browser using your real logged-in session, then extracts the rendered content. Render is slower; prefer the default unless the plain fetch returns a login wall or empty content.",
    parameters: Type.Object({
      goal: goalParam(),
      url: Type.String({
        description: "Absolute URL to fetch (https:// assumed if no scheme).",
      }),
      render: Type.Optional(
        Type.Boolean({
          description:
            "Load via the in-app browser (real login session, runs page JS) instead of a headless HTTP GET. Use for login-walled or JS-rendered pages. Falls back to HTTP automatically on failure.",
        })
      ),
      maxChars: Type.Optional(
        Type.Number({
          description: "Max characters of page text to return (default 40000).",
        })
      ),
      timeoutMs: Type.Optional(
        Type.Number({ description: "Request timeout in milliseconds." })
      ),
    }),
    execute: async (_id, params) => {
      const res = await invoke<WebFetchResponse>("web_fetch", {
        req: {
          url: params.url,
          render: params.render ?? false,
          maxChars: params.maxChars,
          timeoutMs: params.timeoutMs,
        },
      });
      const header =
        `# ${res.title || "(untitled)"}\n` +
        `URL: ${res.finalUrl} (HTTP ${res.status}, mode=${res.mode})\n`;
      const linkLines =
        res.links.length > 0
          ? "\n\nLinks:\n" +
            res.links
              .slice(0, 40)
              .map((l) => `- ${l.text || l.href} -> ${l.href}`)
              .join("\n")
          : "";
      const suffix = res.truncated ? "\n…(内容已截断)" : "";
      return textResult(header + "\n" + res.text + suffix + linkLines, res);
    },
  });
}

const BUILDERS: Record<InternalToolId, (deps: InternalToolDeps) => AgentTool> = {
  checkpoint: checkpointTool,
  ask_human: askHumanTool,
  bash: bashTool,
  read: readTool,
  write: writeTool,
  edit: editTool,
  ls: lsTool,
  grep: grepTool,
  duckdb_query: duckDbQueryTool,
  data_chart_html: dataChartHtmlTool,
  data_report_html: dataReportHtmlTool,
  web_fetch: webFetchTool,
};

/** Build the selected internal tools. */
export function buildInternalTools(
  enabled: InternalToolId[],
  deps: InternalToolDeps
): AgentTool[] {
  return enabled
    .filter((id) => id in BUILDERS)
    .map((id) => BUILDERS[id](deps));
}
