import type { ProviderAdapter } from "@/lib/providers/types";
import { chat, chatStream } from "./chat";
import { listModels } from "./models";

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
  };
}

export { listModels } from "./models";
export { chat, chatStream } from "./chat";
