import { createCollectionStore } from "./createCollectionStore";
import {
  apiKeyRepo,
  skillRepo,
  mcpRepo,
  volcCredentialRepo,
} from "@/data/repositories";

export const useApiKeyStore = createCollectionStore(apiKeyRepo);
export const useSkillStore = createCollectionStore(skillRepo);
export const useMcpStore = createCollectionStore(mcpRepo);
export const useVolcCredentialStore = createCollectionStore(volcCredentialRepo);
