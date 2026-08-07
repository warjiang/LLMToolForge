import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/config";
import { ApiKeyDialog } from "@/pages/api-keys/ApiKeyDialog";
import type { ApiKey } from "@/types";

const listModels = vi.hoisted(() => vi.fn());

vi.mock("@/lib/providers", () => ({
  getAdapter: () => ({
    listModels,
  }),
}));

const editingKey: ApiKey = {
  id: "key-1",
  name: "火山-CodingPlan",
  provider: "Custom",
  key: "sk-test",
  baseUrl: "https://example.test/v1",
  models: ["chosen-model"],
  createdAt: "2026-08-07T00:00:00.000Z",
  updatedAt: "2026-08-07T00:00:00.000Z",
};

describe("ApiKeyDialog model candidates", () => {
  beforeEach(async () => {
    listModels.mockReset();
    await i18n.changeLanguage("zh");
  });

  it("shows fetched models as candidates and only adds them when selected", async () => {
    const user = userEvent.setup();
    listModels.mockResolvedValue([
      { id: "candidate-a", features: [] },
      { id: "candidate-b", features: [] },
    ]);

    render(
      <ApiKeyDialog
        open
        editing={editingKey}
        onOpenChange={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "尝试拉取" }));

    const candidates = await screen.findByLabelText("候选模型");
    expect(within(candidates).getByText("candidate-a")).toBeTruthy();
    expect(within(candidates).getByText("candidate-b")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "移除 candidate-a" })
    ).toBeNull();

    await user.click(
      within(candidates).getByRole("button", { name: "添加 candidate-a" })
    );

    expect(screen.getByRole("button", { name: "移除 candidate-a" })).toBeTruthy();
    expect(
      within(candidates).getByRole("button", { name: "已添加 candidate-a" })
    ).toHaveProperty("disabled", true);
  });
});
