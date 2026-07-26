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
  await screen.findByText("gateway/model");
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

  it("generates a prompt, renders three examples, and saves one record", async () => {
    const user = userEvent.setup();
    const generatePrompt = vi.fn().mockResolvedValue(prompt);
    const generateExamples = vi.fn().mockResolvedValue([
      { method: "类比", title: "共享节点", content: "示例一" },
      { method: "功能融合", title: "可信雨伞", content: "示例二" },
      { method: "情境叙事", title: "雨夜网络", content: "示例三" },
    ]);
    const upsert = vi.fn().mockResolvedValue(undefined);
    renderHarness({
      client: { generatePrompt, generateExamples },
      history: { upsert },
    });

    await startRound(user);
    await user.click(
      screen.getByRole("button", { name: "生成 3 个示例" }),
    );

    expect(await screen.findByText("共享节点")).toBeTruthy();
    expect(screen.getByText("可信雨伞")).toBeTruthy();
    expect(screen.getByText("雨夜网络")).toBeTruthy();
    expect(generatePrompt).toHaveBeenCalledTimes(1);
    expect(generateExamples).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("opens recent history and deletes a confirmed record", async () => {
    const user = userEvent.setup();
    const record = {
      id: "round-history",
      mode: "inspiration" as const,
      modelId: "gateway/model",
      locale: "zh" as const,
      options: {
        itemCount: 2 as const,
        semanticDistance: "far" as const,
        domain: "any",
        abstraction: "mixed" as const,
        purpose: "divergent" as const,
      },
      prompt,
      answer: "",
      hints: [],
      examples: [],
      evaluation: null,
      createdAt: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:00:00.000Z",
    };
    const list = vi
      .fn()
      .mockResolvedValueOnce([record])
      .mockResolvedValueOnce([record])
      .mockResolvedValueOnce([]);
    const remove = vi.fn().mockResolvedValue(undefined);
    renderHarness({ history: { list, remove } });

    await user.click(
      await screen.findByRole("button", { name: "最近记录" }),
    );
    expect(await screen.findByText("雨伞 + 区块链")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "删除记录" }),
    );
    const confirmButtons = await screen.findAllByRole("button", {
      name: "删除记录",
    });
    await user.click(confirmButtons[confirmButtons.length - 1]!);

    expect(remove).toHaveBeenCalledWith("round-history");
  });
});
