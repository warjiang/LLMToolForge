import { createCollectionStore } from "./createCollectionStore";
import {
  apiKeyRepo,
  skillRepo,
  skillProjectConfigRepo,
  mcpRepo,
  volcCredentialRepo,
  gatewayConnectionRepo,
  agentDefinitionRepo,
  sshHostRepo,
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
export const useSshHostStore = createCollectionStore(sshHostRepo);
export { useChatStore } from "./chat";
export { useDebugStore } from "./debug";
export { useSessionGroupStore } from "./sessionGroups";
export { useLocaleStore } from "./locale";
export { useMarketSettingsStore } from "./marketSettings";
export { useSshSessionStore } from "./sshSessions";
export type { TerminalTab } from "./sshSessions";

/** Collection stores that mirror synced repositories. */
const syncedCollectionStores = [
  useApiKeyStore,
  useSkillStore,
  useSkillProjectConfigStore,
  useMcpStore,
  useVolcCredentialStore,
  useGatewayStore,
  useAgentDefStore,
  useSshHostStore,
];

/** Reload all synced collections from storage (after a sync/restore). */
export async function reloadSyncedData(): Promise<void> {
  await Promise.all(syncedCollectionStores.map((s) => s.getState().load()));
}
