/**
 * Expose the bundled OpenConnector runtime to the agent as four discovery-style
 * tools, mirroring OpenConnector's own MCP tool set. We deliberately do NOT
 * flatten the 10k+ catalog actions into individual tools; instead the agent
 * discovers apps/actions on demand and executes by id:
 *
 *   - `connector_list_apps`        browse the provider catalog
 *   - `connector_search_actions`   find actions by keyword
 *   - `connector_get_action_guide` read an action's agent.md (schema + usage)
 *   - `connector_execute_action`   run an action with a JSON input
 *
 * All calls go through the local runtime HTTP API via the frontend client. The
 * runtime must be started (Connectors page) — otherwise each tool returns a
 * clear, actionable error instead of throwing, so the agent can tell the user
 * what to do.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@earendil-works/pi-ai";
import {
  executeAction,
  getActionGuide,
  getRuntimeStatus,
  listProviders,
  searchActions,
  type ConnectorStatus,
} from "@/lib/connector/api";
import { text } from "./shared";

const NOT_RUNNING_HINT =
  "OpenConnector 运行时未启动。请在应用的「连接器」页面点击「启动服务」，" +
  "并为目标 Provider 配置好凭证后再重试。";

async function runningStatus(): Promise<ConnectorStatus | null> {
  try {
    const status = await getRuntimeStatus();
    return status.running ? status : null;
  } catch {
    return null;
  }
}

function schema(properties: Record<string, unknown>, required: string[] = []): TSchema {
  return {
    type: "object",
    properties,
    required,
  } as unknown as TSchema;
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function buildConnectorTools(): AgentTool[] {
  const listApps: AgentTool = {
    name: "connector_list_apps",
    label: "Connector: list apps",
    description:
      "List available third-party provider apps from the OpenConnector catalog. " +
      "Optionally filter by a keyword (matches service id, display name or category). " +
      "Use this to discover which apps are integrable before searching actions.",
    parameters: schema({
      keyword: {
        type: "string",
        description: "Optional case-insensitive filter over app name/category.",
      },
      limit: {
        type: "number",
        description: "Max apps to return (default 50).",
      },
    }),
    execute: async (_id, params) => {
      const status = await runningStatus();
      if (!status) throw new Error(NOT_RUNNING_HINT);
      const p = (params ?? {}) as { keyword?: string; limit?: number };
      const all = await listProviders(status);
      const kw = (p.keyword ?? "").trim().toLowerCase();
      const filtered = kw
        ? all.filter(
            (a) =>
              a.service.toLowerCase().includes(kw) ||
              a.displayName.toLowerCase().includes(kw) ||
              a.categories.some((c) => c.toLowerCase().includes(kw))
          )
        : all;
      const limit = Math.max(1, Math.min(p.limit ?? 50, 200));
      const apps = filtered.slice(0, limit).map((a) => ({
        service: a.service,
        name: a.displayName,
        authTypes: a.authTypes,
        categories: a.categories,
      }));
      return {
        content: [
          text(
            `Found ${filtered.length} app(s)${kw ? ` matching "${kw}"` : ""}, showing ${apps.length}:\n${jsonText(apps)}`
          ),
        ],
        details: { total: filtered.length, apps },
      };
    },
  };

  const searchActionsTool: AgentTool = {
    name: "connector_search_actions",
    label: "Connector: search actions",
    description:
      "Search the OpenConnector catalog for actions by keyword (e.g. 'send email', " +
      "'create issue'). Returns matching action ids with names and descriptions. " +
      "Use the returned action id with connector_get_action_guide and connector_execute_action.",
    parameters: schema(
      {
        query: {
          type: "string",
          description: "Keywords describing the action you want.",
        },
        limit: {
          type: "number",
          description: "Max results to return (default 20).",
        },
      },
      ["query"]
    ),
    execute: async (_id, params) => {
      const status = await runningStatus();
      if (!status) throw new Error(NOT_RUNNING_HINT);
      const p = (params ?? {}) as { query?: string; limit?: number };
      const query = (p.query ?? "").trim();
      if (!query) throw new Error("query 不能为空");
      const limit = Math.max(1, Math.min(p.limit ?? 20, 50));
      const results = await searchActions(status, query, limit);
      const slim = results.map((r) => ({
        id: r.id,
        service: r.service,
        name: r.name,
        description: r.description,
      }));
      return {
        content: [
          text(
            `Found ${slim.length} action(s) for "${query}":\n${jsonText(slim)}`
          ),
        ],
        details: { actions: slim },
      };
    },
  };

  const getGuide: AgentTool = {
    name: "connector_get_action_guide",
    label: "Connector: action guide",
    description:
      "Fetch the agent guide (Markdown) for a specific action id, including its " +
      "input schema, required credentials/scopes and usage notes. Always read this " +
      "before calling connector_execute_action for an unfamiliar action.",
    parameters: schema(
      {
        actionId: {
          type: "string",
          description: "Action id, e.g. 'github.create_issue'.",
        },
      },
      ["actionId"]
    ),
    execute: async (_id, params) => {
      const status = await runningStatus();
      if (!status) throw new Error(NOT_RUNNING_HINT);
      const p = (params ?? {}) as { actionId?: string };
      const actionId = (p.actionId ?? "").trim();
      if (!actionId) throw new Error("actionId 不能为空");
      const guide = await getActionGuide(status, actionId);
      return {
        content: [text(guide || `(no guide for ${actionId})`)],
        details: { actionId },
      };
    },
  };

  const execute: AgentTool = {
    name: "connector_execute_action",
    label: "Connector: execute action",
    description:
      "Execute an OpenConnector action by id with a JSON input object. Credentials " +
      "are supplied by the runtime from the user's configured connections; you never " +
      "handle secrets. A failed action returns ok:false with an error message rather " +
      "than throwing. Optionally pass a connection alias to pick a specific account.",
    parameters: schema(
      {
        actionId: {
          type: "string",
          description: "Action id to execute, e.g. 'hackernews.get_top_stories'.",
        },
        input: {
          type: "object",
          description:
            "Input arguments matching the action's input schema. Use {} when none.",
        },
        alias: {
          type: "string",
          description:
            "Optional connection alias to select a specific configured account.",
        },
      },
      ["actionId"]
    ),
    execute: async (_id, params) => {
      const status = await runningStatus();
      if (!status) throw new Error(NOT_RUNNING_HINT);
      const p = (params ?? {}) as {
        actionId?: string;
        input?: unknown;
        alias?: string;
      };
      const actionId = (p.actionId ?? "").trim();
      if (!actionId) throw new Error("actionId 不能为空");
      const res = await executeAction(
        status,
        actionId,
        p.input ?? {},
        p.alias?.trim() || undefined
      );
      if (!res.ok) {
        const detail = res.message || res.errorCode || "action failed";
        throw new Error(`Action ${actionId} failed: ${detail}`);
      }
      return {
        content: [text(jsonText(res.data ?? res.raw))],
        details: {
          actionId,
          executionId: res.executionId,
          data: res.data,
        },
      };
    },
  };

  return [listApps, searchActionsTool, getGuide, execute];
}
