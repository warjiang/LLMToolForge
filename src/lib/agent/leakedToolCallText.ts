const LEAKED_TOOL_PREFIX = "<functions.";

export const DEFAULT_LEAKED_CHECKPOINT_MESSAGE =
  "The model wrote a checkpoint tool call as plain text, so no real approval was opened. Please retry this turn so the agent can call the checkpoint tool correctly.";

interface SanitizedText {
  text: string;
  toolNames: string[];
}

function jsonObjectEnd(text: string, start: number): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }

  return null;
}

function consumeLeakedToolCall(text: string, start: number) {
  const prefixEnd = start + LEAKED_TOOL_PREFIX.length;
  const nameMatch = /^[a-zA-Z0-9_-]+/.exec(text.slice(prefixEnd));
  if (!nameMatch) return null;

  const toolName = nameMatch[0];
  const nextTag = text.indexOf("<", prefixEnd);
  const close = text.indexOf(">", prefixEnd);
  const jsonStart = text.indexOf("{", prefixEnd);

  if (jsonStart !== -1 && (nextTag === -1 || jsonStart < nextTag)) {
    const jsonEnd = jsonObjectEnd(text, jsonStart);
    if (jsonEnd !== null) {
      let end = jsonEnd;
      while (/\s/.test(text[end] ?? "")) end += 1;
      if (text[end] === ">") end += 1;
      const closing = new RegExp(`^</functions\\.${toolName}>`, "i").exec(
        text.slice(end)
      );
      if (closing) end += closing[0].length;
      return { end, toolName };
    }
  }

  if (close !== -1) return { end: close + 1, toolName };
  return null;
}

function stripLeakedToolCalls(text: string): SanitizedText {
  if (!text.includes(LEAKED_TOOL_PREFIX)) return { text, toolNames: [] };

  let cursor = 0;
  let output = "";
  const toolNames: string[] = [];

  while (cursor < text.length) {
    const start = text.indexOf(LEAKED_TOOL_PREFIX, cursor);
    if (start === -1) {
      output += text.slice(cursor);
      break;
    }

    const consumed = consumeLeakedToolCall(text, start);
    if (!consumed) {
      output += text.slice(cursor);
      break;
    }

    output += text.slice(cursor, start);
    toolNames.push(consumed.toolName);
    cursor = consumed.end;
  }

  return {
    text: output.replace(/^\s+/, "").replace(/\n{3,}/g, "\n\n"),
    toolNames,
  };
}

export function hasLeakedCheckpointToolCall(text: string): boolean {
  return /<functions\.checkpoint\b/i.test(text);
}

export function sanitizeLeakedToolCallText(
  text: string,
  options: { checkpointFallback?: string } = {}
): string {
  if (!text.includes(LEAKED_TOOL_PREFIX)) return text;
  if (hasLeakedCheckpointToolCall(text)) {
    return options.checkpointFallback ?? DEFAULT_LEAKED_CHECKPOINT_MESSAGE;
  }
  return stripLeakedToolCalls(text).text;
}
