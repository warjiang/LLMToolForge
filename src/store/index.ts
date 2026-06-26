import { createCollectionStore } from "./createCollectionStore";
import {
  apiKeyRepo,
  skillRepo,
  skillProjectConfigRepo,
  mcpRepo,
  volcCredentialRepo,
  gatewayConnectionRepo,
  agentDefinitionRepo,
} from "@/data/repositories";

export const useApiKeyStore = createCollectionStore(apiKeyRepo);
export const useSkillStore = createCollectionStore(skillRepo);
export const useSkillProjectConfigStore = createCollectionStore(
  skillProjectConfigRepo
);
export const useMcpStore = createCollectionStore(mcpRepo);
export const useVolcCredentialStore = createCollectionStore(volcCredentialRepo);
export const useGatewayStore = createCollectionStore(gatewayConnectionRepo);
export const useAgentDefStore = createCollectionStore(agentDefinitionRepo);
export { useChatStore } from "./chat";
export { useLocaleStore } from "./locale";
