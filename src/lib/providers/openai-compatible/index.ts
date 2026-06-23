import type { ProviderAdapter } from "@/lib/providers/types";
import { chat, chatStream } from "./chat";
import { imageGeneration } from "./images";
import { listModels } from "./models";
import { getVideoGenerationTask, videoGeneration } from "./videos";

/** Factory for an OpenAI-compatible gateway adapter (new-api / litellm). */
export function createOpenAICompatibleAdapter(
  provider: string
): ProviderAdapter {
  return {
    provider,
    wireFormats: ["openai-chat"],
    listModels: (cred) => listModels(provider, cred),
    chat: (req, cred) => chat(req, cred),
    chatStream: (req, cred) => chatStream(req, cred),
    imageGeneration: (req, cred) => imageGeneration(req, cred),
    videoGeneration: (req, cred) => videoGeneration(req, cred),
    getVideoGenerationTask: (req, cred) => getVideoGenerationTask(req, cred),
  };
}

export { listModels } from "./models";
export { chat, chatStream } from "./chat";
export { imageGeneration } from "./images";
export { getVideoGenerationTask, videoGeneration } from "./videos";
