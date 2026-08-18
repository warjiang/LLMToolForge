import { afterEach, describe, expect, it, vi } from "vitest";
import { promptTemplateRepo } from "@/data/repositories";
import { syncRegistry } from "@/data/sync/registry";
import {
  reloadSyncedData,
  useAgentDefStore,
  useApiKeyStore,
  useGatewayStore,
  useMcpStore,
  usePromptStore,
  useSkillProjectConfigStore,
  useSkillStore,
  useSshHostStore,
  useVolcCredentialStore,
} from "@/store";

const collectionStores = [
  useApiKeyStore,
  useSkillStore,
  useSkillProjectConfigStore,
  useMcpStore,
  useVolcCredentialStore,
  useGatewayStore,
  useAgentDefStore,
  useSshHostStore,
  usePromptStore,
];

function collectionDataStates() {
  return collectionStores.map((store) => {
    const { items, loading, loaded, error } = store.getState();
    return { items: [...items], loading, loaded, error };
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Prompt sync registration", () => {
  it("uses the promptTemplates repository key in the sync registry", () => {
    expect(promptTemplateRepo.storeKey).toBe("promptTemplates");

    const resource = syncRegistry.find(
      (entry) => entry.id === promptTemplateRepo.storeKey
    );
    expect(resource).toEqual({
      id: "promptTemplates",
      labelKey: "sync_res_prompts",
      repo: promptTemplateRepo,
    });
  });

  it("reloads the Prompt collection after sync or restore", async () => {
    const statesBeforeReload = collectionDataStates();
    const loads = collectionStores.map((store) =>
      vi.spyOn(store.getState(), "load").mockResolvedValue(undefined)
    );

    await reloadSyncedData();

    expect(loads).toHaveLength(collectionStores.length);
    loads.forEach((load) => expect(load).toHaveBeenCalledOnce());
    expect(collectionDataStates()).toEqual(statesBeforeReload);
  });
});
