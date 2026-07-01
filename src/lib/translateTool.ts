import type {
  ChatMessage,
  ModelInfo,
  ProviderCredential,
} from "@/lib/providers/types";
import type { ApiKey, GatewayConnection, VolcCredential } from "@/types";

export type TranslateLanguage =
  | "auto"
  | "zh"
  | "en"
  | "ja"
  | "ko"
  | "fr"
  | "de"
  | "es";

export type TargetTranslateLanguage = Exclude<TranslateLanguage, "auto">;

export type TranslateStyle = "faithful" | "natural" | "technical" | "casual";

export interface TranslateOption<T extends string = string> {
  value: T;
  labelKey: string;
}

export const TRANSLATE_LANGUAGES: TranslateOption<TranslateLanguage>[] = [
  { value: "auto", labelKey: "tool_translate_lang_auto" },
  { value: "zh", labelKey: "tool_translate_lang_zh" },
  { value: "en", labelKey: "tool_translate_lang_en" },
  { value: "ja", labelKey: "tool_translate_lang_ja" },
  { value: "ko", labelKey: "tool_translate_lang_ko" },
  { value: "fr", labelKey: "tool_translate_lang_fr" },
  { value: "de", labelKey: "tool_translate_lang_de" },
  { value: "es", labelKey: "tool_translate_lang_es" },
];

export const TARGET_TRANSLATE_LANGUAGES: TranslateOption<TargetTranslateLanguage>[] =
  TRANSLATE_LANGUAGES.filter(
    (l): l is TranslateOption<TargetTranslateLanguage> => l.value !== "auto"
  );

export const TRANSLATE_STYLES: TranslateOption<TranslateStyle>[] = [
  { value: "faithful", labelKey: "tool_translate_style_faithful" },
  { value: "natural", labelKey: "tool_translate_style_natural" },
  { value: "technical", labelKey: "tool_translate_style_technical" },
  { value: "casual", labelKey: "tool_translate_style_casual" },
];

const LANGUAGE_NAMES: Record<TranslateLanguage, string> = {
  auto: "自动检测",
  zh: "中文",
  en: "英文",
  ja: "日文",
  ko: "韩文",
  fr: "法文",
  de: "德文",
  es: "西班牙文",
};

const STYLE_INSTRUCTIONS: Record<TranslateStyle, string> = {
  faithful: "忠实：尽量保持原文含义、结构和语气，不增删信息。",
  natural: "自然：在不改变含义的前提下，让译文符合目标语言的自然表达。",
  technical: "技术文档：使用准确、克制、专业的技术文档表达，保留代码、命令、参数名、专有名词和 Markdown 结构。",
  casual: "口语化：使用清晰、自然、轻松的口语表达，但不改变事实含义。",
};

export interface BuildTranslateMessagesInput {
  input: string;
  sourceLanguage: TranslateLanguage;
  targetLanguage: TargetTranslateLanguage;
  style: TranslateStyle;
}

export function buildTranslateMessages({
  input,
  sourceLanguage,
  targetLanguage,
  style,
}: BuildTranslateMessagesInput): ChatMessage[] {
  const source = LANGUAGE_NAMES[sourceLanguage];
  const target = LANGUAGE_NAMES[targetLanguage];
  const styleInstruction = STYLE_INSTRUCTIONS[style];

  return [
    {
      role: "system",
      content:
        "你是一个专业翻译引擎。只输出译文，不输出解释、前后缀、Markdown 代码围栏或额外说明。保留原文中的代码、变量名、URL、命令、数字、列表和 Markdown 结构。",
    },
    {
      role: "user",
      content: [
        `源语言：${source}`,
        `目标语言：${target}`,
        `翻译风格：${styleInstruction}`,
        "",
        "请翻译以下文本：",
        input.trim(),
      ].join("\n"),
    },
  ];
}

export interface TranslateModelOption {
  key: string;
  label: string;
  provider: string;
  model: ModelInfo;
  credential: ProviderCredential;
  wireFormat?: "openai-chat" | "openai-responses" | "anthropic" | "gemini";
}

function isChatModel(model: ModelInfo): boolean {
  return !model.supportsImageGeneration && !model.supportsVideoGeneration;
}

function optionLabel(connName: string, model: ModelInfo): string {
  return `${connName} / ${model.name || model.id}`;
}

export function buildTranslateModelOptions(
  volcCredentials: VolcCredential[],
  gatewayConnections: GatewayConnection[],
  apiKeys: ApiKey[]
): TranslateModelOption[] {
  const options: TranslateModelOption[] = [];

  for (const cred of volcCredentials) {
    const apiKey = (cred.apiKeys ?? []).find((k) => k.key)?.key;
    if (!apiKey) continue;
    for (const model of cred.models ?? []) {
      if (!isChatModel(model)) continue;
      options.push({
        key: `volc:${cred.id}:${model.id}`,
        label: optionLabel(cred.name, model),
        provider: "volcengine",
        model,
        credential: { apiKey, region: cred.region },
        wireFormat: "openai-responses",
      });
    }
  }

  for (const conn of gatewayConnections) {
    if (!conn.baseUrl || !conn.apiKey) continue;
    for (const model of conn.models ?? []) {
      if (!isChatModel(model)) continue;
      options.push({
        key: `gw:${conn.id}:${model.id}`,
        label: optionLabel(conn.name, model),
        provider: conn.provider,
        model,
        credential: { baseUrl: conn.baseUrl, apiKey: conn.apiKey },
        wireFormat: "openai-chat",
      });
    }
  }

  for (const conn of apiKeys) {
    if (!conn.baseUrl || !conn.key) continue;
    for (const modelId of conn.models ?? []) {
      const model: ModelInfo = {
        id: modelId,
        name: modelId,
        provider: "manual",
      };
      options.push({
        key: `key:${conn.id}:${modelId}`,
        label: optionLabel(conn.name, model),
        provider: "manual",
        model,
        credential: { baseUrl: conn.baseUrl, apiKey: conn.key },
        wireFormat: "openai-chat",
      });
    }
  }

  return options;
}
