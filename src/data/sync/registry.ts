import type { SyncableResource } from "./types";
import {
  apiKeyRepo,
  skillRepo,
  skillProjectConfigRepo,
  mcpRepo,
  volcCredentialRepo,
  gatewayConnectionRepo,
  agentDefinitionRepo,
  sshHostRepo,
} from "../repositories";

/**
 * Registry of all syncable resources.
 *
 * To make a new collection syncable, add a single entry here (its `id` must
 * equal the repository's `storeKey`, and `labelKey` is an i18n key under the
 * `pages` namespace). The sync engine and UI pick it up automatically — no
 * other change is required.
 */
export const syncRegistry: SyncableResource[] = [
  { id: apiKeyRepo.storeKey, labelKey: "sync_res_api_keys", repo: apiKeyRepo },
  { id: skillRepo.storeKey, labelKey: "sync_res_skills", repo: skillRepo },
  {
    id: skillProjectConfigRepo.storeKey,
    labelKey: "sync_res_skill_projects",
    repo: skillProjectConfigRepo,
  },
  { id: mcpRepo.storeKey, labelKey: "sync_res_mcp", repo: mcpRepo },
  {
    id: volcCredentialRepo.storeKey,
    labelKey: "sync_res_volc",
    repo: volcCredentialRepo,
  },
  {
    id: gatewayConnectionRepo.storeKey,
    labelKey: "sync_res_gateways",
    repo: gatewayConnectionRepo,
  },
  {
    id: agentDefinitionRepo.storeKey,
    labelKey: "sync_res_agents",
    repo: agentDefinitionRepo,
  },
  { id: sshHostRepo.storeKey, labelKey: "sync_res_ssh", repo: sshHostRepo },
];
