import { describe, expect, test } from "vitest";
import type {
  PersistedChatMessage,
  ToolCallRecord,
} from "@/types/chat";
import { summaryReportArtifactsByMessage } from "../summaryReportArtifacts";

const BASE_TIME = "2026-08-04T00:00:00.000Z";

function message(
  id: string,
  role: PersistedChatMessage["role"],
  content: string
): PersistedChatMessage {
  return {
    id,
    sessionId: "session",
    role,
    status: "complete",
    content,
    parts: [],
    attachments: [],
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
  };
}

function toolCall(
  id: string,
  messageId: string,
  toolName: string,
  resultJson: unknown,
  overrides: Partial<ToolCallRecord> = {}
): ToolCallRecord {
  return {
    id,
    sessionId: "session",
    messageId,
    source: "internal",
    toolName,
    title: toolName,
    argumentsJson: "{}",
    resultJson,
    status: "success",
    startedAt: BASE_TIME,
    ...overrides,
  };
}

describe("summary report artifacts", () => {
  test("attaches HTML artifacts from earlier assistant steps to the final summary", () => {
    const messages = [
      message("user-1", "user", "生成调研报告"),
      message("work-1", "assistant", "正在构建报告"),
      message("work-2", "assistant", ""),
      message("summary-1", "assistant", "调研完成，以下是核心结论。"),
    ];
    const calls = [
      toolCall("create", "work-1", "html_artifact_create", {
        outputDir: "/workspace/report",
        title: "行业调研报告",
      }),
      toolCall("block", "work-2", "html_artifact_block", {
        outputDir: "/workspace/report",
        title: "行业调研报告",
      }),
    ];

    expect(summaryReportArtifactsByMessage(messages, calls)).toEqual(
      new Map([
        [
          "summary-1",
          [
            {
              kind: "browser",
              dir: "/workspace/report",
              title: "行业调研报告",
            },
          ],
        ],
      ])
    );
  });

  test("keeps distinct reports and ignores failed or non-report artifacts", () => {
    const messages = [
      message("user-1", "user", "生成两份报告"),
      message("work-1", "assistant", "处理中"),
      message("summary-1", "assistant", "两份报告均已完成。"),
    ];
    const calls = [
      toolCall("report-a", "work-1", "data_report_html", {
        outputDir: "/workspace/report-a",
        title: "报告 A",
      }),
      toolCall("report-b", "work-1", "write", {
        path: "/workspace/report-b/index.html",
      }),
      toolCall(
        "failed",
        "work-1",
        "html_artifact_create",
        { outputDir: "/workspace/failed" },
        { status: "error" }
      ),
      toolCall("chart", "work-1", "data_chart_html", {
        outputDir: "/workspace/chart",
      }),
    ];

    expect(summaryReportArtifactsByMessage(messages, calls)).toEqual(
      new Map([
        [
          "summary-1",
          [
            {
              kind: "browser",
              dir: "/workspace/report-a",
              title: "报告 A",
            },
            {
              kind: "browser",
              dir: "/workspace/report-b",
              title: "index.html",
            },
          ],
        ],
      ])
    );
  });

  test("does not expose a report when the turn has no final text summary", () => {
    const messages = [
      message("user-1", "user", "生成报告"),
      message("work-1", "assistant", ""),
    ];
    const calls = [
      toolCall("report", "work-1", "html_artifact_create", {
        outputDir: "/workspace/report",
      }),
    ];

    expect(summaryReportArtifactsByMessage(messages, calls)).toEqual(new Map());
  });

  test("does not treat text before the report tool call as a final summary", () => {
    const messages = [
      message("user-1", "user", "生成报告"),
      message("preamble", "assistant", "正在生成报告。"),
      message("work-1", "assistant", ""),
    ];
    const calls = [
      toolCall("report", "work-1", "html_artifact_create", {
        outputDir: "/workspace/report",
      }),
    ];

    expect(summaryReportArtifactsByMessage(messages, calls)).toEqual(new Map());
  });

  test("associates historical tool calls with their own user turn", () => {
    const messages = [
      message("user-1", "user", "第一份报告"),
      message("work-1", "assistant", ""),
      message("summary-1", "assistant", "第一份完成。"),
      message("user-2", "user", "第二份报告"),
      message("work-2", "assistant", ""),
      message("summary-2", "assistant", "第二份完成。"),
    ];
    const calls = [
      toolCall(
        "newer",
        "work-2",
        "html_artifact_block",
        { outputDir: "/workspace/report-2" },
        { startedAt: "2026-08-04T00:02:00.000Z" }
      ),
      toolCall(
        "older",
        "work-1",
        "html_artifact_block",
        { outputDir: "/workspace/report-1" },
        { startedAt: "2026-08-04T00:01:00.000Z" }
      ),
    ];

    expect(summaryReportArtifactsByMessage(messages, calls)).toEqual(
      new Map([
        [
          "summary-1",
          [{ kind: "browser", dir: "/workspace/report-1" }],
        ],
        [
          "summary-2",
          [{ kind: "browser", dir: "/workspace/report-2" }],
        ],
      ])
    );
  });
});
