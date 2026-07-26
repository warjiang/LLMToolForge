import { createOpenAICompatibleAdapter } from "@/lib/providers/openai-compatible";
import type { ChatMessage } from "@/lib/providers";
import {
  type ExposedModel,
  type ModelFeature,
} from "@/lib/unifiedApi";
import { useUnifiedStore } from "@/store/unified";
import {
  parseCreativityEvaluation,
  parseCreativityExamples,
  parseCreativityHint,
  parseCreativityPrompt,
} from "./parser";
import {
  buildEvaluationMessages,
  buildExampleMessages,
  buildHintMessages,
  buildPromptMessages,
  buildRepairMessages,
} from "./prompts";
import type {
  CreativityContextRequest,
  CreativityEvaluation,
  CreativityEvaluationRequest,
  CreativityExample,
  CreativityHint,
  CreativityHintRequest,
  CreativityPrompt,
  CreativityPromptRequest,
} from "./types";

const FALLBACK_LOCAL_KEY = "sk-unified-local";
const MEDIA_ONLY_FEATURES = new Set<ModelFeature>(["image-gen", "video-gen"]);

export type CreativityComplete = (
  modelId: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
) => Promise<string>;

export interface CreativityClient {
  listModels(): Promise<ExposedModel[]>;
  generatePrompt(
    modelId: string,
    request: CreativityPromptRequest,
    signal?: AbortSignal,
  ): Promise<CreativityPrompt>;
  generateHint(
    modelId: string,
    request: CreativityHintRequest,
    signal?: AbortSignal,
  ): Promise<CreativityHint>;
  generateExamples(
    modelId: string,
    request: CreativityContextRequest,
    signal?: AbortSignal,
  ): Promise<CreativityExample[]>;
  evaluate(
    modelId: string,
    request: CreativityEvaluationRequest,
    signal?: AbortSignal,
  ): Promise<CreativityEvaluation>;
}

function isTextModel(model: ExposedModel): boolean {
  return !model.features.some((feature) => MEDIA_ONLY_FEATURES.has(feature));
}

export function selectCreativityModel(
  models: ExposedModel[],
  disabledModelIds: Set<string>,
  preferredModelId?: string | null,
): ExposedModel | null {
  const available = models.filter(
    (model) => !disabledModelIds.has(model.id) && isTextModel(model),
  );
  return (
    available.find((model) => model.id === preferredModelId) ??
    available[0] ??
    null
  );
}

async function listUnifiedModels(): Promise<ExposedModel[]> {
  await useUnifiedStore.getState().init();
  await useUnifiedStore.getState().hydrateModels();
  const state = useUnifiedStore.getState();
  const disabled = new Set(state.config.disabledModelIds);
  return state.models.filter(
    (model) => !disabled.has(model.id) && isTextModel(model),
  );
}

async function ensureUnifiedReady(): Promise<{
  baseUrl: string;
  apiKey: string;
}> {
  await useUnifiedStore.getState().init();
  await useUnifiedStore.getState().hydrateModels();
  let state = useUnifiedStore.getState();
  if (!state.supported) {
    throw new Error("Unified Gateway is only available in the desktop app");
  }
  if (!state.status?.running) {
    await state.start();
    state = useUnifiedStore.getState();
  }
  if (!state.status?.running) {
    throw new Error(state.error || "Unified Gateway is unavailable");
  }
  return {
    baseUrl: `http://127.0.0.1:${state.config.port}/v1`,
    apiKey: state.config.localKey.trim() || FALLBACK_LOCAL_KEY,
  };
}

const unifiedAdapter = createOpenAICompatibleAdapter("unified");

async function completeThroughUnified(
  modelId: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const credential = await ensureUnifiedReady();
  const response = await unifiedAdapter.chat(
    {
      model: modelId,
      messages,
      params: { temperature: 0.8 },
      signal,
    },
    credential,
  );
  const content = response.content.trim();
  if (!content) {
    throw new Error("The model returned an empty response");
  }
  return content;
}

async function parseWithRepair<T>(
  complete: CreativityComplete,
  modelId: string,
  messages: ChatMessage[],
  schema: string,
  parse: (text: string) => T,
  signal?: AbortSignal,
): Promise<T> {
  const raw = await complete(modelId, messages, signal);
  try {
    return parse(raw);
  } catch {
    const repaired = await complete(
      modelId,
      buildRepairMessages(raw, schema),
      signal,
    );
    return parse(repaired);
  }
}

export function createCreativityClient({
  complete = completeThroughUnified,
}: {
  complete?: CreativityComplete;
} = {}): CreativityClient {
  return {
    listModels: listUnifiedModels,
    generatePrompt: (modelId, request, signal) =>
      parseWithRepair(
        complete,
        modelId,
        buildPromptMessages(request),
        '{"items":[{"text":"string","kind":"thing|concept"}]}',
        (text) => parseCreativityPrompt(text, request.options.itemCount),
        signal,
      ),
    generateHint: (modelId, request, signal) =>
      parseWithRepair(
        complete,
        modelId,
        buildHintMessages(request),
        '{"level":1,"content":"string"}',
        (text) => parseCreativityHint(text, request.level),
        signal,
      ),
    generateExamples: (modelId, request, signal) =>
      parseWithRepair(
        complete,
        modelId,
        buildExampleMessages(request),
        '{"examples":[{"method":"string","title":"string","content":"string"}]}',
        parseCreativityExamples,
        signal,
      ),
    evaluate: (modelId, request, signal) =>
      parseWithRepair(
        complete,
        modelId,
        buildEvaluationMessages(request),
        '{"dimensions":{"distance":{"level":"starting|clear|strong","reason":"string"},"coherence":{"level":"starting|clear|strong","reason":"string"},"novelty":{"level":"starting|clear|strong","reason":"string"},"depth":{"level":"starting|clear|strong","reason":"string"}},"strengths":["string"],"improvement":"string","followUpQuestion":"string"}',
        parseCreativityEvaluation,
        signal,
      ),
  };
}

export const creativityClient = createCreativityClient();
