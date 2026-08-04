import type {
  PersistedChatMessage,
  ToolCallRecord,
} from "@/types/chat";

export interface SummaryReportArtifact {
  kind: "browser";
  dir: string;
  title?: string;
  file?: string;
}

function stringField(value: unknown, field: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : undefined;
}

function splitPath(path: string): { dir: string; file: string } | null {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const separator = normalized.lastIndexOf("/");
  if (separator <= 0 || separator === normalized.length - 1) return null;
  return {
    dir: normalized.slice(0, separator),
    file: normalized.slice(separator + 1),
  };
}

function reportArtifact(call: ToolCallRecord): SummaryReportArtifact | null {
  if (call.status !== "success") return null;

  if (
    call.toolName === "html_artifact_create" ||
    call.toolName === "html_artifact_block" ||
    call.toolName === "data_report_html"
  ) {
    const dir = stringField(call.resultJson, "outputDir");
    if (!dir) return null;
    const title = stringField(call.resultJson, "title");
    return title
      ? { kind: "browser", dir, title }
      : { kind: "browser", dir };
  }

  if (call.toolName !== "write") return null;
  const path = stringField(call.resultJson, "path");
  if (!path || !/\.html?$/i.test(path)) return null;
  const parts = splitPath(path);
  if (!parts) return null;
  return parts.file.toLowerCase() === "index.html"
    ? { kind: "browser", dir: parts.dir, title: parts.file }
    : {
        kind: "browser",
        dir: parts.dir,
        file: parts.file,
        title: parts.file,
      };
}

export function summaryReportArtifactsByMessage(
  messages: readonly PersistedChatMessage[],
  toolCalls: readonly ToolCallRecord[]
): Map<string, SummaryReportArtifact[]> {
  const result = new Map<string, SummaryReportArtifact[]>();
  const messageTurn = new Map<string, number>();
  const messageOrder = new Map<string, number>();
  const summaryCandidatesByTurn = new Map<
    number,
    Array<{ id: string; order: number }>
  >();
  let turn = -1;

  messages.forEach((message, order) => {
    if (message.role === "user") turn += 1;
    if (turn < 0) return;
    messageTurn.set(message.id, turn);
    messageOrder.set(message.id, order);
    if (
      message.role === "assistant" &&
      message.status === "complete" &&
      !message.error &&
      message.content.trim()
    ) {
      const candidates = summaryCandidatesByTurn.get(turn) ?? [];
      candidates.push({ id: message.id, order });
      summaryCandidatesByTurn.set(turn, candidates);
    }
  });

  const artifactsByTurn = new Map<
    number,
    Map<string, SummaryReportArtifact>
  >();
  const lastArtifactOrderByTurn = new Map<number, number>();
  const orderedCalls = [...toolCalls].sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)
  );

  for (const call of orderedCalls) {
    if (!call.messageId) continue;
    const callTurn = messageTurn.get(call.messageId);
    if (callTurn == null) continue;
    const artifact = reportArtifact(call);
    if (!artifact) continue;
    const anchorOrder = messageOrder.get(call.messageId);
    if (anchorOrder == null) continue;
    const key = `${artifact.dir}\0${artifact.file ?? ""}`;
    const turnArtifacts =
      artifactsByTurn.get(callTurn) ??
      new Map<string, SummaryReportArtifact>();
    turnArtifacts.set(key, artifact);
    artifactsByTurn.set(callTurn, turnArtifacts);
    lastArtifactOrderByTurn.set(
      callTurn,
      Math.max(lastArtifactOrderByTurn.get(callTurn) ?? -1, anchorOrder)
    );
  }

  for (const [turnIndex, artifacts] of artifactsByTurn) {
    const lastArtifactOrder = lastArtifactOrderByTurn.get(turnIndex);
    const candidates = summaryCandidatesByTurn.get(turnIndex) ?? [];
    let summary: { id: string; order: number } | undefined;
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      if (candidates[index].order > (lastArtifactOrder ?? -1)) {
        summary = candidates[index];
        break;
      }
    }
    if (!summary) continue;
    if (artifacts.size) result.set(summary.id, [...artifacts.values()]);
  }

  return result;
}
