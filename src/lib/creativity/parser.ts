import { uid } from "@/lib/utils";
import type {
  CreativityEvaluation,
  CreativityExample,
  CreativityHint,
  CreativityItemCount,
  CreativityPrompt,
  CreativityPromptItem,
  EvaluationDimension,
  EvaluationLevel,
} from "./types";

type JsonObject = Record<string, unknown>;
const SENTENCE_PUNCTUATION = /[，。！？；：,!?;:\n\r]/u;

function objectValue(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

export function validateCombinationLabel(value: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    Array.from(normalized).length > 24 ||
    SENTENCE_PUNCTUATION.test(normalized)
  ) {
    throw new Error("Combination item must be a short phrase");
  }
  return normalized;
}

export function parseJsonObject(text: string): JsonObject {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Structured response does not contain a JSON object");
  }
  return objectValue(
    JSON.parse(candidate.slice(start, end + 1)) as unknown,
    "response",
  );
}

function promptItem(value: unknown, index: number): CreativityPromptItem {
  const item = objectValue(value, `items[${index}]`);
  const kind = item.kind;
  if (kind !== "thing" && kind !== "concept") {
    throw new Error(`items[${index}].kind must be thing or concept`);
  }
  return {
    text: validateCombinationLabel(
      stringValue(item.text, `items[${index}].text`),
    ),
    kind,
  };
}

export function parseCreativityPrompt(
  text: string,
  expectedCount: CreativityItemCount,
): CreativityPrompt {
  const value = parseJsonObject(text);
  const items = arrayValue(value.items, "items").map(promptItem);
  return createPrompt(items, expectedCount);
}

export function createCreativityPrompt(
  values: string[],
  expectedCount: CreativityItemCount,
): CreativityPrompt {
  const items = values.map((value) => ({
    text: validateCombinationLabel(value),
    kind: "concept" as const,
  }));
  return createPrompt(items, expectedCount);
}

function createPrompt(
  items: CreativityPromptItem[],
  expectedCount: CreativityItemCount,
): CreativityPrompt {
  if (items.length !== expectedCount) {
    throw new Error(`items must contain exactly ${expectedCount} entries`);
  }
  const normalized = items.map((item) => item.text.trim().toLocaleLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("items contain duplicate concepts");
  }
  return { id: uid("prompt"), items };
}

export function parseCreativityHint(
  text: string,
  expectedLevel: 1 | 2 | 3,
): CreativityHint {
  const value = parseJsonObject(text);
  if (value.level !== expectedLevel) {
    throw new Error(`hint level must be ${expectedLevel}`);
  }
  return {
    level: expectedLevel,
    content: stringValue(value.content, "content"),
  };
}

function example(value: unknown, index: number): CreativityExample {
  const item = objectValue(value, `examples[${index}]`);
  return {
    method: stringValue(item.method, `examples[${index}].method`),
    title: stringValue(item.title, `examples[${index}].title`),
    content: stringValue(item.content, `examples[${index}].content`),
  };
}

export function parseCreativityExamples(text: string): CreativityExample[] {
  const value = parseJsonObject(text);
  const examples = arrayValue(value.examples, "examples").map(example);
  if (examples.length !== 3) {
    throw new Error("examples must contain exactly three entries");
  }
  const methods = examples.map((item) =>
    item.method.trim().toLocaleLowerCase(),
  );
  if (new Set(methods).size !== methods.length) {
    throw new Error("example method values must be distinct");
  }
  return examples;
}

const EVALUATION_LEVELS = new Set<EvaluationLevel>([
  "starting",
  "clear",
  "strong",
]);

function dimension(value: unknown, label: string): EvaluationDimension {
  const item = objectValue(value, label);
  if (
    typeof item.level !== "string" ||
    !EVALUATION_LEVELS.has(item.level as EvaluationLevel)
  ) {
    throw new Error(`${label}.level is invalid`);
  }
  return {
    level: item.level as EvaluationLevel,
    reason: stringValue(item.reason, `${label}.reason`),
  };
}

export function parseCreativityEvaluation(
  text: string,
): CreativityEvaluation {
  const value = parseJsonObject(text);
  const dimensions = objectValue(value.dimensions, "dimensions");
  const parsedDimensions = {
    distance: dimension(dimensions.distance, "distance"),
    coherence: dimension(dimensions.coherence, "coherence"),
    novelty: dimension(dimensions.novelty, "novelty"),
    depth: dimension(dimensions.depth, "depth"),
  };
  const strengths = arrayValue(value.strengths, "strengths").map(
    (item, index) => stringValue(item, `strengths[${index}]`),
  );
  if (strengths.length === 0) {
    throw new Error("strengths must contain at least one entry");
  }
  return {
    dimensions: parsedDimensions,
    strengths,
    improvement: stringValue(value.improvement, "improvement"),
    followUpQuestion: stringValue(
      value.followUpQuestion,
      "followUpQuestion",
    ),
  };
}
