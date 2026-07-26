import type {
  CreativityContextRequest,
  CreativityEvaluationRequest,
  CreativityHintRequest,
  CreativityMessages,
  CreativityPromptRequest,
} from "./types";

const JSON_ONLY_RULE =
  "Return exactly one JSON object. Do not use Markdown fences or add commentary.";

function languageName(locale: "zh" | "en"): string {
  return locale === "zh" ? "简体中文" : "English";
}

function messages(instruction: string, input: string): CreativityMessages {
  return [
    {
      role: "system",
      content: `${instruction}\n${JSON_ONLY_RULE}`,
    },
    { role: "user", content: input },
  ];
}

function promptItems(items: string[]): string {
  return JSON.stringify(items);
}

export function buildPromptMessages(
  request: CreativityPromptRequest,
): CreativityMessages {
  const { locale, options } = request;
  return messages(
    [
      "You create concise combinational-creativity exercises.",
      "Each item must be one short noun or concept phrase naming a single independently connectable thing or idea.",
      "Never return a question, task instruction, creative brief, complete sentence, or a phrase that already combines multiple requested items.",
      "Keep every item under 24 characters and avoid sentence punctuation.",
      "Avoid proper names, unsafe content, and duplicate concepts.",
    ].join(" "),
    [
      `Output language: ${languageName(locale)}`,
      `Item count: ${options.itemCount}`,
      `Semantic distance: ${options.semanticDistance}`,
      `Domain: ${options.domain}`,
      `Abstraction: ${options.abstraction}`,
      `Purpose: ${options.purpose}`,
      'Schema: {"items":[{"text":"string","kind":"thing|concept"}]}',
    ].join("\n"),
  );
}

export function buildHintMessages(
  request: CreativityHintRequest,
): CreativityMessages {
  return messages(
    "You are a creativity coach. Give only the requested hint level and never reveal a complete answer.",
    [
      `Output language: ${languageName(request.locale)}`,
      `Prompt items: ${promptItems(request.promptItems)}`,
      `Hint level: ${request.level}`,
      `Previous hints: ${JSON.stringify(request.previousHints)}`,
      'Levels: 1=observation question, 2=connection direction, 3=partial framework.',
      'Schema: {"level":1,"content":"string"}',
    ].join("\n"),
  );
}

export function buildExampleMessages(
  request: CreativityContextRequest,
): CreativityMessages {
  return messages(
    "Generate exactly three useful combinations using genuinely different connection mechanisms.",
    [
      `Output language: ${languageName(request.locale)}`,
      `Prompt items: ${promptItems(request.promptItems)}`,
      'Schema: {"examples":[{"method":"string","title":"string","content":"string"}]}',
    ].join("\n"),
  );
}

export function buildEvaluationMessages(
  request: CreativityEvaluationRequest,
): CreativityMessages {
  return messages(
    "Evaluate a user's combinational-creativity answer constructively. Do not provide a numeric score.",
    [
      `Output language: ${languageName(request.locale)}`,
      `Prompt items: ${promptItems(request.promptItems)}`,
      `User answer: ${request.answer}`,
      "Each dimension needs level starting|clear|strong and a non-empty reason.",
      'Schema: {"dimensions":{"distance":{"level":"starting|clear|strong","reason":"string"},"coherence":{"level":"starting|clear|strong","reason":"string"},"novelty":{"level":"starting|clear|strong","reason":"string"},"depth":{"level":"starting|clear|strong","reason":"string"}},"strengths":["string"],"improvement":"string","followUpQuestion":"string"}',
    ].join("\n"),
  );
}

export function buildRepairMessages(
  raw: string,
  schema: string,
): CreativityMessages {
  return messages(
    "Repair the response into the requested JSON shape without changing its substantive content.",
    `Target schema: ${schema}\nOriginal response:\n${raw}`,
  );
}
