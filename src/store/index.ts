import { createCollectionStore } from "./createCollectionStore";
import { apiKeyRepo, skillRepo, mcpRepo } from "@/data/repositories";

export const useApiKeyStore = createCollectionStore(apiKeyRepo);
export const useSkillStore = createCollectionStore(skillRepo);
export const useMcpStore = createCollectionStore(mcpRepo);
