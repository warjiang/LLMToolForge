import { createCollectionStore } from "./createCollectionStore";
import {
  apiKeyRepo,
  skillRepo,
  skillProjectConfigRepo,
  mcpRepo,
  volcCredentialRepo,
  gatewayConnectionRepo,
} from "@/data/repositories";

export const useApiKeyStore = createCollectionStore(apiKeyRepo);
export const useSkillStore = createCollectionStore(skillRepo);
export const useSkillProjectConfigStore = createCollectionStore(
  skillProjectConfigRepo
);
export const useMcpStore = createCollectionStore(mcpRepo);
export const useVolcCredentialStore = createCollectionStore(volcCredentialRepo);
export const useGatewayStore = createCollectionStore(gatewayConnectionRepo);
export { useChatStore } from "./chat";
