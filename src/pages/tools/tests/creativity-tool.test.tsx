import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/config";
import type { CreativityClient } from "@/lib/creativity/client";
import type { CreativityHistoryStore } from "@/lib/creativity/history";
import { CreativityTool } from "@/pages/tools/creativity/CreativityTool";

export const prompt = {
  id: "prompt-1",
  items: [
    { text: "雨伞", kind: "thing" as const },
    { text: "区块链", kind: "concept" as const },
  ],
};

export function renderHarness({
  client: clientOverrides = {},
  history: historyOverrides = {},
}: {
  client?: Partial<CreativityClient>;
  history?: Partial<CreativityHistoryStore>;
} = {}) {
  const client: CreativityClient = {
    listModels: vi.fn().mockResolvedValue([
      {
        id: "gateway/model",
        realModel: "model",
        provider: "manual",
        baseUrl: "https://example.test/v1",
        apiKey: "secret",
        connId: "key:test",
        connName: "Gateway",
        features: [],
      },
    ]),
    generatePrompt: vi.fn().mockResolvedValue(prompt),
    generateHint: vi.fn(),
    generateExamples: vi.fn(),
    evaluate: vi.fn(),
    ...clientOverrides,
  };
  const history: CreativityHistoryStore = {
    list: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    loadSettings: vi.fn().mockResolvedValue(null),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    ...historyOverrides,
  };
  render(<CreativityTool client={client} history={history} />);
  return { client, history };
}

export async function startRound(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "生成组合" }));
  await screen.findByText("雨伞");
}

beforeEach(async () => {
  await i18n.changeLanguage("zh");
});

describe("CreativityTool", () => {
  it("renders both modes and the core prompt controls", async () => {
    renderHarness();

    expect(
      await screen.findByRole("button", { name: "快速灵感" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "结构化训练" }),
    ).toBeTruthy();
    expect(screen.getByText("语义距离")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "更多设置" }),
    ).toBeTruthy();
  });
});
