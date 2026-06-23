import type {
  ChatRequest,
  ChatResult,
  ChatStreamChunk,
  ModelInfo,
  ProviderAdapter,
  ProviderCredential,
} from "@/lib/providers/types";
import { chat, chatStream } from "./chat";
import { imageGeneration } from "./images";
import { listEndpoints, type VolcAkSk } from "./management";
import { getVideoGenerationTask, videoGeneration } from "./videos";

function toAkSk(cred: ProviderCredential): VolcAkSk {
  if (!cred.accessKey || !cred.secretKey) {
    throw new Error("缺少 AccessKey / SecretKey");
  }
  return {
    accessKey: cred.accessKey,
    secretKey: cred.secretKey,
    region: cred.region,
  };
}

export const volcengineAdapter: ProviderAdapter = {
  provider: "volcengine",
  wireFormats: ["openai-chat", "openai-responses"],

  async listModels(cred: ProviderCredential): Promise<ModelInfo[]> {
    return listEndpoints(toAkSk(cred));
  },

  chat(req: ChatRequest, cred: ProviderCredential): Promise<ChatResult> {
    return chat(req, cred);
  },

  chatStream(
    req: ChatRequest,
    cred: ProviderCredential
  ): AsyncGenerator<ChatStreamChunk, void, unknown> {
    return chatStream(req, cred);
  },

  imageGeneration,

  videoGeneration,

  getVideoGenerationTask,
};

export * from "./management";
export * from "./catalog";
export * from "./images";
export * from "./videos";
