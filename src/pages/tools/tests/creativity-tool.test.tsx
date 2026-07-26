import { act, render, screen } from "@testing-library/react";
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

  it("shows a recoverable empty state when no model is available", async () => {
    renderHarness({
      client: { listModels: vi.fn().mockResolvedValue([]) },
    });

    expect(
      await screen.findByText(
        "没有可用文本模型，请先在统一网关中启用模型。",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "前往统一网关" }),
    ).toBeTruthy();
  });

  it("preserves spaces in a custom topic domain", async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(
      await screen.findByRole("button", { name: "更多设置" }),
    );
    const domain = screen.getByLabelText("主题领域") as HTMLInputElement;

    await user.type(domain, "product design");

    expect(domain.value).toBe("product design");
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
      answer: "共享雨伞所有权",
      hints: [],
      examples: [
        { method: "类比", title: "可信雨伞", content: "示例内容" },
      ],
      evaluation: {
        dimensions: {
          distance: { level: "strong" as const, reason: "跨领域明显" },
          coherence: { level: "clear" as const, reason: "机制可解释" },
          novelty: { level: "strong" as const, reason: "组合新颖" },
          depth: { level: "starting" as const, reason: "仍可展开" },
        },
        strengths: ["发现了所有权联结"],
        improvement: "补充场景",
        followUpQuestion: "如何验证？",
      },
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
    expect(screen.getByText("可信雨伞")).toBeTruthy();
    expect(screen.getByText("跨领域明显")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "删除记录" }),
    );
    const confirmButtons = await screen.findAllByRole("button", {
      name: "删除记录",
    });
    await user.click(confirmButtons[confirmButtons.length - 1]!);

    expect(remove).toHaveBeenCalledWith("round-history");
  });

  it("reveals hints in order and keeps examples locked before evaluation", async () => {
    const user = userEvent.setup();
    const generateHint = vi
      .fn()
      .mockResolvedValueOnce({ level: 1, content: "先观察共同约束" })
      .mockResolvedValueOnce({ level: 2, content: "尝试迁移所有权概念" });
    renderHarness({ client: { generateHint } });

    await user.click(
      await screen.findByRole("button", { name: "结构化训练" }),
    );
    await startRound(user);

    expect(
      screen.queryByRole("button", { name: "生成 3 个示例" }),
    ).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "解锁第 1 级提示" }),
    );
    expect(await screen.findByText("先观察共同约束")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "解锁第 2 级提示" }),
    ).toBeTruthy();
    expect(generateHint).toHaveBeenCalledWith(
      "gateway/model",
      expect.objectContaining({ level: 1, previousHints: [] }),
      expect.any(AbortSignal),
    );
  });

  it("renders four dimensions and unlocks examples after evaluation", async () => {
    const user = userEvent.setup();
    const upsert = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn().mockResolvedValue({
      dimensions: {
        distance: { level: "strong", reason: "跨领域明显" },
        coherence: { level: "clear", reason: "机制可解释" },
        novelty: { level: "strong", reason: "组合新颖" },
        depth: { level: "starting", reason: "仍可展开" },
      },
      strengths: ["发现了所有权联结"],
      improvement: "补充具体使用情境",
      followUpQuestion: "如果没有手机，如何验证所有权？",
    });
    renderHarness({
      client: { evaluate },
      history: { upsert },
    });

    await user.click(
      await screen.findByRole("button", { name: "结构化训练" }),
    );
    await startRound(user);
    const evaluateButton = screen.getByRole("button", {
      name: "评价我的答案",
    }) as HTMLButtonElement;
    expect(evaluateButton.disabled).toBe(true);
    await user.type(
      screen.getByLabelText("你的联结"),
      "共享雨伞所有权",
    );
    await user.click(evaluateButton);

    expect(await screen.findByText("跨领域明显")).toBeTruthy();
    expect(screen.getByText("机制可解释")).toBeTruthy();
    expect(screen.getByText("组合新颖")).toBeTruthy();
    expect(screen.getByText("仍可展开")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "生成 3 个示例" }),
    ).toBeTruthy();
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("confirms before replacing an unsubmitted training answer", async () => {
    const user = userEvent.setup();
    const generatePrompt = vi.fn().mockResolvedValue(prompt);
    renderHarness({ client: { generatePrompt } });

    await user.click(
      await screen.findByRole("button", { name: "结构化训练" }),
    );
    await startRound(user);
    await user.type(screen.getByLabelText("你的联结"), "尚未提交的草稿");
    await user.click(screen.getByRole("button", { name: "换一组" }));

    expect(await screen.findByText("放弃当前答案？")).toBeTruthy();
    expect(generatePrompt).toHaveBeenCalledTimes(1);
    await user.click(
      screen.getByRole("button", { name: "放弃并换题" }),
    );
    await vi.waitFor(() => {
      expect(generatePrompt).toHaveBeenCalledTimes(2);
    });
  });

  it("preserves the prompt and answer after evaluation failure", async () => {
    const user = userEvent.setup();
    renderHarness({
      client: {
        evaluate: vi.fn().mockRejectedValue(new Error("invalid JSON")),
      },
    });

    await user.click(
      await screen.findByRole("button", { name: "结构化训练" }),
    );
    await startRound(user);
    const answer = screen.getByLabelText("你的联结") as HTMLTextAreaElement;
    await user.type(answer, "共享雨伞所有权");
    await user.click(
      screen.getByRole("button", { name: "评价我的答案" }),
    );

    expect(await screen.findByText("invalid JSON")).toBeTruthy();
    expect(screen.getByText("雨伞")).toBeTruthy();
    expect(answer.value).toBe("共享雨伞所有权");
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
  });

  it("shows a save warning without hiding successful examples", async () => {
    const user = userEvent.setup();
    renderHarness({
      client: {
        generateExamples: vi.fn().mockResolvedValue([
          { method: "类比", title: "共享节点", content: "示例一" },
          { method: "功能融合", title: "可信雨伞", content: "示例二" },
          { method: "情境叙事", title: "雨夜网络", content: "示例三" },
        ]),
      },
      history: {
        upsert: vi.fn().mockRejectedValue(new Error("disk full")),
      },
    });

    await startRound(user);
    await user.click(
      screen.getByRole("button", { name: "生成 3 个示例" }),
    );

    expect(await screen.findByText("共享节点")).toBeTruthy();
    expect(screen.getByText("结果未保存")).toBeTruthy();
  });

  it("falls back when the remembered model no longer exists", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    renderHarness({
      history: {
        loadSettings: vi.fn().mockResolvedValue({
          modelId: "missing/model",
          mode: "inspiration",
          options: {
            itemCount: 2,
            semanticDistance: "far",
            domain: "any",
            abstraction: "mixed",
            purpose: "divergent",
          },
        }),
        saveSettings,
      },
    });

    expect(await screen.findByText("gateway/model")).toBeTruthy();
    expect(
      screen.getByText("原模型不可用，已切换到 gateway/model。"),
    ).toBeTruthy();
    await vi.waitFor(() => {
      expect(saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: "gateway/model" }),
      );
    });
  });

  it("does not apply a response after switching rounds", async () => {
    const user = userEvent.setup();
    let resolveFirst!: (value: typeof prompt) => void;
    const first = new Promise<typeof prompt>((resolve) => {
      resolveFirst = resolve;
    });
    const second = {
      id: "prompt-2",
      items: [
        { text: "火山", kind: "thing" as const },
        { text: "乐谱", kind: "thing" as const },
      ],
    };
    const generatePrompt = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(second);
    renderHarness({ client: { generatePrompt } });

    await screen.findByText("gateway/model");
    await user.click(
      screen.getByRole("button", { name: "生成组合" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "重新生成组合" }),
    );
    expect(await screen.findByText("火山")).toBeTruthy();

    await act(async () => resolveFirst(prompt));
    expect(screen.queryByText("雨伞")).toBeNull();
  });
});
