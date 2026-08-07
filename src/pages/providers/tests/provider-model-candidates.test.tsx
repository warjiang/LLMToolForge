import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/config";
import { useGatewayStore, useVolcCredentialStore } from "@/store";
import { GatewayProviders } from "@/pages/providers/GatewayProviders";
import { VolcengineProviders } from "@/pages/providers/VolcengineProviders";
import type { GatewayConnection, VolcCredential } from "@/types";
import type { ModelInfo } from "@/lib/providers/types";

const gatewayListModels = vi.hoisted(() => vi.fn());
const listEndpoints = vi.hoisted(() => vi.fn());

vi.mock("@/lib/providers", () => ({
  getAdapter: () => ({
    listModels: gatewayListModels,
  }),
}));

vi.mock("@/lib/providers/volcengine", () => ({
  getRawApiKey: vi.fn(),
  listApiKeys: vi.fn(),
  listEndpoints,
}));

const savedGatewayModel: ModelInfo = {
  id: "saved-gateway-model",
  name: "saved-gateway-model",
  provider: "openai",
};

const candidateGatewayModel: ModelInfo = {
  id: "candidate-gateway-model",
  name: "candidate-gateway-model",
  provider: "openai",
};

const savedVolcModel: ModelInfo = {
  id: "saved-volc-model",
  name: "saved-volc-model",
  provider: "volcengine",
};

const candidateVolcModel: ModelInfo = {
  id: "candidate-volc-model",
  name: "candidate-volc-model",
  provider: "volcengine",
};

const gatewayConnection: GatewayConnection = {
  id: "gw-1",
  name: "Model Hub",
  provider: "new-api",
  baseUrl: "https://example.test/v1",
  apiKey: "sk-test",
  models: [savedGatewayModel],
  createdAt: "2026-08-07T00:00:00.000Z",
  updatedAt: "2026-08-07T00:00:00.000Z",
};

const volcCredential: VolcCredential = {
  id: "volc-1",
  name: "Volc Main",
  accessKey: "ak-test",
  secretKey: "sk-test",
  region: "cn-beijing",
  project: "default",
  apiKeys: [],
  models: [savedVolcModel],
  createdAt: "2026-08-07T00:00:00.000Z",
  updatedAt: "2026-08-07T00:00:00.000Z",
};

describe("provider model candidates", () => {
  beforeEach(async () => {
    gatewayListModels.mockReset();
    listEndpoints.mockReset();
    await i18n.changeLanguage("zh");
    useGatewayStore.setState({
      items: [],
      loaded: true,
      loading: false,
      error: null,
    });
    useVolcCredentialStore.setState({
      items: [],
      loaded: true,
      loading: false,
      error: null,
    });
  });

  it("lets gateway provider users add fetched candidates one by one and delete saved models", async () => {
    const user = userEvent.setup();
    const edit = vi.fn();
    gatewayListModels.mockResolvedValue([candidateGatewayModel]);
    useGatewayStore.setState({
      items: [gatewayConnection],
      edit,
    });

    render(
      <GatewayProviders
        provider={{
          id: "new-api",
          kind: "gateway",
          label: "New API",
          description: "provider_desc_newapi",
        }}
      />
    );

    await user.click(screen.getByRole("button", { name: "拉取模型" }));

    const candidates = await screen.findByLabelText("候选模型");
    expect(within(candidates).getByText("candidate-gateway-model")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "删除 candidate-gateway-model" })
    ).toBeNull();
    expect(edit).not.toHaveBeenCalledWith("gw-1", {
      models: [candidateGatewayModel],
    });

    await user.click(
      within(candidates).getByRole("button", {
        name: "添加 candidate-gateway-model",
      })
    );
    expect(edit).toHaveBeenLastCalledWith("gw-1", {
      models: [savedGatewayModel, candidateGatewayModel],
    });

    await user.click(screen.getByRole("button", { name: "删除 saved-gateway-model" }));
    expect(edit).toHaveBeenLastCalledWith("gw-1", {
      models: [candidateGatewayModel],
    });
  });

  it("lets Volcengine users add fetched candidates one by one and delete saved models", async () => {
    const user = userEvent.setup();
    const edit = vi.fn();
    listEndpoints.mockResolvedValue([candidateVolcModel]);
    useVolcCredentialStore.setState({
      items: [volcCredential],
      edit,
    });

    render(<VolcengineProviders />);

    await user.click(screen.getByRole("button", { name: "拉取模型" }));

    const candidates = await screen.findByLabelText("候选模型");
    expect(within(candidates).getByText("candidate-volc-model")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "删除 candidate-volc-model" })
    ).toBeNull();
    expect(edit).not.toHaveBeenCalledWith("volc-1", {
      models: [candidateVolcModel],
    });

    await user.click(
      within(candidates).getByRole("button", {
        name: "添加 candidate-volc-model",
      })
    );
    expect(edit).toHaveBeenLastCalledWith("volc-1", {
      models: [savedVolcModel, candidateVolcModel],
    });

    await user.click(screen.getByRole("button", { name: "删除 saved-volc-model" }));
    expect(edit).toHaveBeenLastCalledWith("volc-1", {
      models: [candidateVolcModel],
    });
  });
});
