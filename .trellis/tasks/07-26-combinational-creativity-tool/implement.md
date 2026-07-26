# 组合式创造思维训练工具实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在现有“实用工具”页面交付一个通过统一网关生成随机联结题、示例、渐进提示和结构化评价的双模式创造力训练工具。

**Architecture:** 使用 `src/lib/creativity/` 承载纯领域契约、结构化解析、统一网关客户端和本地历史；使用 `src/pages/tools/creativity/` 承载 reducer 驱动的界面状态与展示组件。所有模型调用都是可取消的独立请求，返回经过运行时校验；历史通过现有 `getStore()` 保存且不加入跨设备同步。

**Tech Stack:** React 19、TypeScript 6、Zustand Unified Store、Tauri Store、OpenAI-compatible Unified Gateway、Vitest、Testing Library、Tailwind CSS、i18next。

---

## 文件结构

新增：

- `vitest.config.ts`：Vitest、React、路径别名和 jsdom 配置。
- `src/test/setup.ts`：每个组件测试后的 DOM 清理。
- `src/lib/creativity/types.ts`：出题、提示、示例、评价、历史和服务接口。
- `src/lib/creativity/prompts.ts`：四类 AI 请求的消息构造。
- `src/lib/creativity/parser.ts`：JSON 提取、类型守卫和业务约束校验。
- `src/lib/creativity/client.ts`：统一网关模型发现、自动启动、模型调用和格式修复重试。
- `src/lib/creativity/history.ts`：设置与最近 50 条记录的本地持久化。
- `src/pages/tools/creativity/state.ts`：当前轮 reducer、异步 operation 和迟到响应保护。
- `src/pages/tools/creativity/CreativityControls.tsx`：模式、模型和出题参数。
- `src/pages/tools/creativity/CreativityWorkspace.tsx`：题目、快速示例和训练工作区。
- `src/pages/tools/creativity/CreativityHistoryDialog.tsx`：历史列表、详情和清理。
- `src/pages/tools/creativity/CreativityTool.tsx`：加载依赖、编排请求和持久化。
- `src/pages/tools/tests/creativity-domain.test.ts`：提示词、解析和状态单测。
- `src/pages/tools/tests/creativity-client.test.ts`：模型选择和格式修复单测。
- `src/pages/tools/tests/creativity-history.test.ts`：本地历史单测。
- `src/pages/tools/tests/creativity-tool.test.tsx`：双模式组件测试。
- `.trellis/tasks/07-26-combinational-creativity-tool/manual-acceptance.md`：桌面端手动验收清单。

修改：

- `package.json`、`pnpm-lock.yaml`：增加测试命令和测试依赖。
- `src/pages/tools/ToolsPage.tsx`：注册 `creativity` Tab。
- `src/pages/tools/tests/tools-page.test.ts`：断言新 Tab 存在。
- `src/i18n/locales/zh/pages.json`、`src/i18n/locales/en/pages.json`：新增完整双语文案。

## Task 1：建立可执行的前端测试基线

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`

- [x] **Step 1：安装测试依赖并添加命令**

Run:

```bash
pnpm add -D vitest jsdom @testing-library/react @testing-library/user-event
```

在 `package.json` 的 `scripts` 中增加：

```json
"test": "vitest run",
"test:watch": "vitest"
```

Expected: `package.json` 和 `pnpm-lock.yaml` 只出现上述测试依赖及其传递依赖变化。

- [x] **Step 2：添加 Vitest 配置**

创建 `vitest.config.ts`：

```ts
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/pages/tools/tests/tools-page.test.ts",
      "src/pages/tools/tests/creativity-*.test.{ts,tsx}",
    ],
    clearMocks: true,
  },
});
```

创建 `src/test/setup.ts`：

```ts
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => cleanup());
```

- [x] **Step 3：把现有工具页断言改为可执行测试**

将 `src/pages/tools/tests/tools-page.test.ts` 改为：

```ts
import { describe, expect, it } from "vitest";
import { TOOL_TAB_ORDER } from "@/pages/tools/ToolsPage";

describe("ToolsPage tabs", () => {
  it("keeps the established tool order", () => {
    expect(TOOL_TAB_ORDER).toContain("json");
    expect(TOOL_TAB_ORDER).toContain("markdown");
    expect(TOOL_TAB_ORDER).toContain("text-editor");
  });
});
```

- [x] **Step 4：运行测试确认基线可执行**

Run:

```bash
pnpm test -- src/pages/tools/tests/tools-page.test.ts
```

Expected: 1 test file passed。

- [x] **Step 5：提交测试基线**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts src/test/setup.ts src/pages/tools/tests/tools-page.test.ts
git commit -m "test: add frontend unit test runner"
```

## Task 2：定义领域契约、提示词与结构化解析

**Files:**

- Create: `src/lib/creativity/types.ts`
- Create: `src/lib/creativity/prompts.ts`
- Create: `src/lib/creativity/parser.ts`
- Create: `src/pages/tools/tests/creativity-domain.test.ts`

- [x] **Step 1：先写失败的领域测试**

创建 `src/pages/tools/tests/creativity-domain.test.ts`，至少包含：

```ts
import { describe, expect, it } from "vitest";
import {
  buildEvaluationMessages,
  buildPromptMessages,
} from "@/lib/creativity/prompts";
import {
  parseCreativityEvaluation,
  parseCreativityExamples,
  parseCreativityPrompt,
} from "@/lib/creativity/parser";

describe("creativity domain", () => {
  it("includes all prompt controls and output language", () => {
    const messages = buildPromptMessages({
      locale: "zh",
      options: {
        itemCount: 3,
        semanticDistance: "far",
        domain: "technology",
        abstraction: "mixed",
        purpose: "product",
      },
    });
    const text = messages.map((message) => message.content).join("\n");
    expect(text).toContain("3");
    expect(text).toContain("far");
    expect(text).toContain("technology");
    expect(text).toContain("mixed");
    expect(text).toContain("product");
    expect(text).toContain("简体中文");
  });

  it("rejects duplicate prompt items after normalization", () => {
    expect(() =>
      parseCreativityPrompt(
        '{"items":[{"text":"Clock","kind":"thing"},{"text":" clock ","kind":"thing"}]}',
        2,
      ),
    ).toThrow(/duplicate/i);
  });

  it("requires three examples with distinct methods", () => {
    expect(() =>
      parseCreativityExamples(
        '{"examples":[{"method":"类比","title":"A","content":"x"},{"method":"类比","title":"B","content":"y"},{"method":"叙事","title":"C","content":"z"}]}',
      ),
    ).toThrow(/method/i);
  });

  it("requires all four evaluation dimensions", () => {
    const messages = buildEvaluationMessages({
      locale: "zh",
      promptItems: ["雨伞", "区块链"],
      answer: "用分布式所有权共享公共雨伞。",
    });
    expect(messages[1]?.content).toContain("分布式所有权");
    expect(() => parseCreativityEvaluation('{"dimensions":{}}')).toThrow(
      /distance/i,
    );
  });
});
```

- [x] **Step 2：运行测试确认失败**

Run:

```bash
pnpm test -- src/pages/tools/tests/creativity-domain.test.ts
```

Expected: FAIL，原因是 `@/lib/creativity/*` 模块不存在。

- [x] **Step 3：实现稳定领域类型**

在 `src/lib/creativity/types.ts` 定义并导出：

```ts
import type { ChatMessage } from "@/lib/providers";

export type CreativityMode = "inspiration" | "training";
export type SemanticDistance = "near" | "cross-domain" | "far";
export type AbstractionLevel = "concrete" | "abstract" | "mixed";
export type CreativityPurpose =
  | "divergent"
  | "product"
  | "story"
  | "problem-solving";
export type EvaluationLevel = "starting" | "clear" | "strong";

export interface CreativityPromptOptions {
  itemCount: 2 | 3;
  semanticDistance: SemanticDistance;
  domain: string;
  abstraction: AbstractionLevel;
  purpose: CreativityPurpose;
}

export interface CreativityPromptItem {
  text: string;
  kind: "thing" | "concept";
}

export interface CreativityPrompt {
  id: string;
  items: CreativityPromptItem[];
}

export interface CreativityHint {
  level: 1 | 2 | 3;
  content: string;
}

export interface CreativityExample {
  method: string;
  title: string;
  content: string;
}

export interface EvaluationDimension {
  level: EvaluationLevel;
  reason: string;
}

export interface CreativityEvaluation {
  dimensions: {
    distance: EvaluationDimension;
    coherence: EvaluationDimension;
    novelty: EvaluationDimension;
    depth: EvaluationDimension;
  };
  strengths: string[];
  improvement: string;
  followUpQuestion: string;
}

export interface CreativityPromptRequest {
  locale: "zh" | "en";
  options: CreativityPromptOptions;
}

export interface CreativityContextRequest {
  locale: "zh" | "en";
  promptItems: string[];
}

export interface CreativityEvaluationRequest
  extends CreativityContextRequest {
  answer: string;
}

export type CreativityMessages = ChatMessage[];
```

- [x] **Step 4：实现提示词构造和解析器**

`prompts.ts` 中为出题、指定级别提示、三个示例和评价分别生成 system/user 两条消息。每个 system message 必须写明：

```ts
const JSON_ONLY_RULE =
  "Return exactly one JSON object. Do not use Markdown fences or add commentary.";
```

`parser.ts` 先从纯文本或 Markdown JSON 代码块提取对象，再使用 `unknown` 类型守卫验证。核心提取逻辑：

```ts
export function parseJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Structured response does not contain a JSON object");
  }
  return JSON.parse(candidate.slice(start, end + 1)) as unknown;
}
```

业务校验必须覆盖：题目数量、空值、标准化去重；提示级别；示例恰好三条和方法去重；四个评价维度、合法等级和非空理由。

- [x] **Step 5：运行领域测试**

Run:

```bash
pnpm test -- src/pages/tools/tests/creativity-domain.test.ts
```

Expected: 全部通过。

- [x] **Step 6：提交领域层**

```bash
git add src/lib/creativity src/pages/tools/tests/creativity-domain.test.ts
git commit -m "feat: add creativity domain contracts"
```

## Task 3：实现统一网关客户端与模型选择

**Files:**

- Create: `src/lib/creativity/client.ts`
- Create: `src/pages/tools/tests/creativity-client.test.ts`

- [x] **Step 1：先写模型选择和修复重试测试**

```ts
import { describe, expect, it, vi } from "vitest";
import {
  createCreativityClient,
  selectCreativityModel,
} from "@/lib/creativity/client";
import type { ExposedModel } from "@/lib/unifiedApi";

const model = (id: string, features: ExposedModel["features"] = []): ExposedModel => ({
  id,
  realModel: id,
  provider: "manual",
  baseUrl: "https://upstream.example/v1",
  apiKey: "secret",
  connId: "key:test",
  connName: "Test",
  features,
});

describe("creativity client", () => {
  it("restores the preferred enabled text model", () => {
    expect(
      selectCreativityModel(
        [model("a"), model("b"), model("image", ["image-gen"])],
        new Set(["a"]),
        "b",
      )?.id,
    ).toBe("b");
  });

  it("falls back to the first available text model", () => {
    expect(
      selectCreativityModel([model("image", ["image-gen"]), model("b")], new Set(), "missing")?.id,
    ).toBe("b");
  });

  it("retries once when the first response has invalid JSON", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce("not json")
      .mockResolvedValueOnce('{"items":[{"text":"雨伞","kind":"thing"},{"text":"区块链","kind":"concept"}]}');
    const client = createCreativityClient({ complete });
    const result = await client.generatePrompt("model", {
      locale: "zh",
      options: {
        itemCount: 2,
        semanticDistance: "far",
        domain: "any",
        abstraction: "mixed",
        purpose: "divergent",
      },
    });
    expect(result.items).toHaveLength(2);
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
```

- [x] **Step 2：运行测试确认失败**

Run:

```bash
pnpm test -- src/pages/tools/tests/creativity-client.test.ts
```

Expected: FAIL，`client.ts` 不存在。

- [x] **Step 3：实现模型过滤和可注入客户端**

`selectCreativityModel` 排除 `disabledModelIds`，并排除带 `image-gen` 或 `video-gen` 的专用生成模型。优先返回仍可用的 preferred model，否则返回按 Unified Store 顺序排列的第一个文本模型。

客户端公共接口：

```ts
export interface CreativityClient {
  listModels(): Promise<ExposedModel[]>;
  generatePrompt(
    modelId: string,
    request: CreativityPromptRequest,
    signal?: AbortSignal,
  ): Promise<CreativityPrompt>;
  generateHint(
    modelId: string,
    request: CreativityContextRequest & {
      level: 1 | 2 | 3;
      previousHints: CreativityHint[];
    },
    signal?: AbortSignal,
  ): Promise<CreativityHint>;
  generateExamples(
    modelId: string,
    request: CreativityContextRequest,
    signal?: AbortSignal,
  ): Promise<CreativityExample[]>;
  evaluate(
    modelId: string,
    request: CreativityEvaluationRequest,
    signal?: AbortSignal,
  ): Promise<CreativityEvaluation>;
}
```

`createCreativityClient` 接收可注入的 `complete` 函数用于单测。第一次解析失败后，第二次调用只携带原始响应、目标 JSON 形状和“只修复格式，不改变内容”的指令；第二次失败直接抛错。

- [x] **Step 4：实现默认统一网关 transport**

默认 `complete` 执行以下步骤：

```ts
async function ensureUnifiedReady(): Promise<{
  baseUrl: string;
  apiKey: string;
}> {
  const store = useUnifiedStore.getState();
  await store.init();
  await useUnifiedStore.getState().hydrateModels();
  if (!useUnifiedStore.getState().status?.running) {
    await useUnifiedStore.getState().start();
  }
  const current = useUnifiedStore.getState();
  if (!current.status?.running) {
    throw new Error(current.error || "Unified Gateway is unavailable");
  }
  return {
    baseUrl: `http://127.0.0.1:${current.config.port}/v1`,
    apiKey: current.config.localKey.trim() || "sk-unified-local",
  };
}
```

使用 `createOpenAICompatibleAdapter("unified")` 调用 `chat`，传入 exposed model id，而不是上游真实 model id。`listModels()` 返回 hydrate 后未禁用的文本模型。

- [x] **Step 5：运行客户端测试和类型检查**

```bash
pnpm test -- src/pages/tools/tests/creativity-client.test.ts
pnpm exec tsc --noEmit
```

Expected: 测试通过；TypeScript 无错误。

- [x] **Step 6：提交客户端**

```bash
git add src/lib/creativity/client.ts src/pages/tools/tests/creativity-client.test.ts
git commit -m "feat: connect creativity tool to unified gateway"
```

## Task 4：实现本地设置和最近历史

**Files:**

- Create: `src/lib/creativity/history.ts`
- Create: `src/pages/tools/tests/creativity-history.test.ts`
- Modify: `src/lib/creativity/types.ts`

- [x] **Step 1：先写历史仓库失败测试**

```ts
import { describe, expect, it } from "vitest";
import type { KeyValueStore } from "@/data/storage";
import { createCreativityHistory } from "@/lib/creativity/history";

class MemoryStore implements KeyValueStore {
  values = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | null> {
    return (this.values.get(key) as T | undefined) ?? null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }
}

describe("creativity history", () => {
  it("upserts one round and keeps only the newest 50 records", async () => {
    const history = createCreativityHistory(new MemoryStore());
    for (let index = 0; index < 51; index += 1) {
      await history.upsert({
        id: `round-${index}`,
        mode: "inspiration",
        modelId: "model",
        locale: "zh",
        options: {
          itemCount: 2,
          semanticDistance: "far",
          domain: "any",
          abstraction: "mixed",
          purpose: "divergent",
        },
        prompt: { id: `prompt-${index}`, items: [] },
        answer: "",
        hints: [],
        examples: [],
        evaluation: null,
        createdAt: new Date(index).toISOString(),
        updatedAt: new Date(index).toISOString(),
      });
    }
    expect(await history.list()).toHaveLength(50);
    await history.upsert({
      ...(await history.list())[0]!,
      answer: "updated",
    });
    expect(await history.list()).toHaveLength(50);
  });
});
```

- [x] **Step 2：运行测试确认失败**

```bash
pnpm test -- src/pages/tools/tests/creativity-history.test.ts
```

Expected: FAIL，历史模块或历史类型不存在。

- [x] **Step 3：实现历史与设置仓库**

`history.ts` 使用两个稳定 key：

```ts
const HISTORY_KEY = "creativityHistory";
const SETTINGS_KEY = "creativitySettings";
const HISTORY_LIMIT = 50;
```

导出的方法：

```ts
export interface CreativityHistoryStore {
  list(): Promise<CreativityHistoryRecord[]>;
  upsert(record: CreativityHistoryRecord): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  loadSettings(): Promise<CreativitySettings | null>;
  saveSettings(settings: CreativitySettings): Promise<void>;
}
```

`upsert` 以 id 替换旧项，按 `updatedAt` 降序排序并 `slice(0, 50)`。`clear` 写入空数组，不产生同步 tombstone。默认实例使用 `getStore()`。

- [x] **Step 4：运行历史测试**

```bash
pnpm test -- src/pages/tools/tests/creativity-history.test.ts
```

Expected: 全部通过。

- [x] **Step 5：提交历史模块**

```bash
git add src/lib/creativity/types.ts src/lib/creativity/history.ts src/pages/tools/tests/creativity-history.test.ts
git commit -m "feat: persist creativity training history"
```

## Task 5：实现当前轮状态机和取消语义

**Files:**

- Create: `src/pages/tools/creativity/state.ts`
- Modify: `src/pages/tools/tests/creativity-domain.test.ts`

- [x] **Step 1：先写 reducer 失败测试**

在 `creativity-domain.test.ts` 增加：

```ts
import {
  createInitialCreativityState,
  creativityReducer,
} from "@/pages/tools/creativity/state";

it("ignores a response from an obsolete round", () => {
  const initial = createInitialCreativityState();
  const loading = creativityReducer(initial, {
    type: "operation-started",
    operation: "prompt",
    roundId: "round-a",
  });
  const nextRound = creativityReducer(loading, {
    type: "round-reset",
    roundId: "round-b",
  });
  const stale = creativityReducer(nextRound, {
    type: "prompt-succeeded",
    roundId: "round-a",
    prompt: { id: "old", items: [] },
  });
  expect(stale.prompt).toBeNull();
  expect(stale.roundId).toBe("round-b");
});

it("keeps the prompt and answer when evaluation fails", () => {
  const state = {
    ...createInitialCreativityState(),
    roundId: "round-a",
    prompt: {
      id: "prompt",
      items: [
        { text: "雨伞", kind: "thing" as const },
        { text: "区块链", kind: "concept" as const },
      ],
    },
    answer: "共享雨伞所有权",
  };
  const failed = creativityReducer(state, {
    type: "operation-failed",
    roundId: "round-a",
    message: "invalid JSON",
  });
  expect(failed.prompt).toEqual(state.prompt);
  expect(failed.answer).toBe(state.answer);
  expect(failed.error).toBe("invalid JSON");
});
```

- [x] **Step 2：运行测试确认失败**

```bash
pnpm test -- src/pages/tools/tests/creativity-domain.test.ts
```

Expected: FAIL，`state.ts` 不存在。

- [x] **Step 3：实现 reducer**

状态至少包含：

```ts
export type CreativityOperation =
  | "prompt"
  | "hint"
  | "examples"
  | "evaluation"
  | null;

export interface CreativityState {
  roundId: string;
  mode: CreativityMode;
  options: CreativityPromptOptions;
  prompt: CreativityPrompt | null;
  answer: string;
  answerDirty: boolean;
  hints: CreativityHint[];
  examples: CreativityExample[];
  evaluation: CreativityEvaluation | null;
  operation: CreativityOperation;
  operationRoundId: string | null;
  error: string | null;
  historyId: string | null;
}
```

所有异步成功/失败 action 都携带 `roundId`。当 action 的 roundId 与当前状态不同，reducer 原样返回 state。`mode-changed` 保留 prompt，清空 answer、hints、examples、evaluation 和 historyId。

- [x] **Step 4：运行状态测试**

```bash
pnpm test -- src/pages/tools/tests/creativity-domain.test.ts
```

Expected: 全部通过。

- [x] **Step 5：提交状态机**

```bash
git add src/pages/tools/creativity/state.ts src/pages/tools/tests/creativity-domain.test.ts
git commit -m "feat: add creativity round state machine"
```

## Task 6：注册工具 Tab、基础界面和国际化

**Files:**

- Modify: `src/pages/tools/ToolsPage.tsx`
- Modify: `src/pages/tools/tests/tools-page.test.ts`
- Create: `src/pages/tools/creativity/CreativityControls.tsx`
- Create: `src/pages/tools/creativity/CreativityWorkspace.tsx`
- Create: `src/pages/tools/creativity/CreativityHistoryDialog.tsx`
- Create: `src/pages/tools/creativity/CreativityTool.tsx`
- Modify: `src/i18n/locales/zh/pages.json`
- Modify: `src/i18n/locales/en/pages.json`
- Create: `src/pages/tools/tests/creativity-tool.test.tsx`

- [x] **Step 1：先写 Tab 和基础视图失败测试**

更新 `tools-page.test.ts`：

```ts
expect(TOOL_TAB_ORDER).toContain("creativity");
```

创建 `creativity-tool.test.tsx`：

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/config";
import type { CreativityClient } from "@/lib/creativity/client";
import type { CreativityHistoryStore } from "@/lib/creativity/history";
import { CreativityTool } from "@/pages/tools/creativity/CreativityTool";

const prompt = {
  id: "prompt-1",
  items: [
    { text: "雨伞", kind: "thing" as const },
    { text: "区块链", kind: "concept" as const },
  ],
};

function renderHarness({
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

async function startRound(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "生成组合" }));
  await screen.findByText("雨伞");
}

beforeEach(async () => {
  await i18n.changeLanguage("zh");
});

describe("CreativityTool", () => {
  it("renders both modes and core prompt controls", async () => {
    renderHarness();
    expect(await screen.findByRole("button", { name: "快速灵感" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "结构化训练" })).toBeTruthy();
    expect(screen.getByText("语义距离")).toBeTruthy();
    expect(screen.getByRole("button", { name: "更多设置" })).toBeTruthy();
  });
});
```

- [x] **Step 2：运行测试确认失败**

```bash
pnpm test -- src/pages/tools/tests/tools-page.test.ts src/pages/tools/tests/creativity-tool.test.tsx
```

Expected: FAIL，新 Tab 和组件尚不存在。

- [x] **Step 3：实现基础组件和 Tab 注册**

在 `TOOL_TAB_ORDER` 中把 `creativity` 放在 `translate` 前；在 tabs 数组增加：

```ts
{
  value: "creativity",
  label: t("creativity_tool"),
  icon: Sparkles,
  Comp: CreativityTool,
}
```

`CreativityTool` 接受可选依赖：

```ts
interface CreativityToolProps {
  client?: CreativityClient;
  history?: CreativityHistoryStore;
}
```

生产默认值使用统一网关客户端和默认历史仓库。基础界面先完成模式切换、模型 Select、2/3 数量选择、语义距离、更多设置 Dialog、生成按钮和空状态；具体异步动作在后续任务接入。

- [x] **Step 4：添加完整双语文案**

中英文 key 使用统一 `creativity_` 前缀，至少覆盖：

- 工具名、说明、两种模式。
- 模型、数量、语义距离、主题、抽象层级、用途。
- 生成、换一组、提示、提交评价、生成示例、重试。
- 四个评价维度和三个等级。
- 历史、删除、清空、确认和所有错误状态。

- [x] **Step 5：运行基础视图测试和构建**

```bash
pnpm test -- src/pages/tools/tests/tools-page.test.ts src/pages/tools/tests/creativity-tool.test.tsx
pnpm build
```

Expected: 测试和构建通过。

- [x] **Step 6：提交基础界面**

```bash
git add src/pages/tools src/i18n/locales/zh/pages.json src/i18n/locales/en/pages.json
git commit -m "feat: add creativity tool workspace"
```

## Task 7：接通快速灵感模式与历史

**Files:**

- Modify: `src/pages/tools/creativity/CreativityTool.tsx`
- Modify: `src/pages/tools/creativity/CreativityWorkspace.tsx`
- Modify: `src/pages/tools/creativity/CreativityHistoryDialog.tsx`
- Modify: `src/pages/tools/tests/creativity-tool.test.tsx`

- [x] **Step 1：先写快速模式失败测试**

```tsx
it("generates a prompt, renders three examples, and saves one record", async () => {
  const user = userEvent.setup();
  const generatePrompt = vi.fn().mockResolvedValue({
    id: "prompt-1",
    items: [
      { text: "雨伞", kind: "thing" },
      { text: "区块链", kind: "concept" },
    ],
  });
  const generateExamples = vi.fn().mockResolvedValue([
    { method: "类比", title: "共享节点", content: "示例一" },
    { method: "功能融合", title: "可信雨伞", content: "示例二" },
    { method: "情境叙事", title: "雨夜网络", content: "示例三" },
  ]);
  const upsert = vi.fn();
  renderHarness({
    client: { generatePrompt, generateExamples },
    history: { upsert },
  });

  await startRound(user);
  await user.click(screen.getByRole("button", { name: "生成 3 个示例" }));
  expect(await screen.findByText("共享节点")).toBeTruthy();
  expect(screen.getByText("可信雨伞")).toBeTruthy();
  expect(screen.getByText("雨夜网络")).toBeTruthy();
  expect(upsert).toHaveBeenCalledTimes(1);
});
```

测试辅助函数必须提供一个可用模型，并为未关注的方法提供明确 mock 返回，不能依赖真实网关。

- [x] **Step 2：运行测试确认失败**

```bash
pnpm test -- src/pages/tools/tests/creativity-tool.test.tsx
```

Expected: FAIL，按钮尚未接入客户端或历史。

- [x] **Step 3：实现快速模式编排**

实现规则：

- 进入工具时加载 models、settings 和 history。
- 恢复 preferred model；失效时选择第一个模型并保存新设置。
- 每次 operation 创建 `AbortController`；新 operation 或卸载时 abort。
- 生成题目成功后 reset 当前轮结果。
- 生成示例成功后 dispatch 结果，再以当前 round ID upsert 历史。
- 请求失败只 dispatch `operation-failed`，保留已有数据。

历史写入失败只设置独立 `saveWarning`，不回滚示例。

- [x] **Step 4：实现历史对话框**

历史对话框加载最近 50 条记录，列表显示时间、模式和题目词语。选择一条后显示规范化详情。删除单条和清空全部使用 `ConfirmDialog`；成功后刷新列表。

- [x] **Step 5：运行快速模式测试**

```bash
pnpm test -- src/pages/tools/tests/creativity-tool.test.tsx src/pages/tools/tests/creativity-history.test.ts
```

Expected: 全部通过。

- [x] **Step 6：提交快速模式**

```bash
git add src/pages/tools/creativity src/pages/tools/tests/creativity-tool.test.tsx
git commit -m "feat: add quick creativity inspiration flow"
```

## Task 8：接通结构化训练模式

**Files:**

- Modify: `src/pages/tools/creativity/CreativityTool.tsx`
- Modify: `src/pages/tools/creativity/CreativityWorkspace.tsx`
- Modify: `src/pages/tools/tests/creativity-tool.test.tsx`

- [x] **Step 1：先写示例门槛和渐进提示失败测试**

```tsx
it("reveals hints in order and keeps examples locked before evaluation", async () => {
  const user = userEvent.setup();
  renderHarness({
    client: {
      generateHint: vi
        .fn()
        .mockResolvedValueOnce({ level: 1, content: "先观察共同约束" })
        .mockResolvedValueOnce({ level: 2, content: "尝试迁移所有权概念" }),
    },
  });

  await user.click(await screen.findByRole("button", { name: "结构化训练" }));
  await startRound(user);
  expect(screen.queryByRole("button", { name: "生成 3 个示例" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "解锁第 1 级提示" }));
  expect(await screen.findByText("先观察共同约束")).toBeTruthy();
  expect(screen.getByRole("button", { name: "解锁第 2 级提示" })).toBeTruthy();
});
```

- [x] **Step 2：先写评价与历史更新失败测试**

```tsx
it("renders four dimensions and unlocks examples after evaluation", async () => {
  const user = userEvent.setup();
  const upsert = vi.fn();
  renderHarness({
    client: {
      evaluate: vi.fn().mockResolvedValue({
        dimensions: {
          distance: { level: "strong", reason: "跨领域明显" },
          coherence: { level: "clear", reason: "机制可解释" },
          novelty: { level: "strong", reason: "组合新颖" },
          depth: { level: "starting", reason: "仍可展开" },
        },
        strengths: ["发现了所有权联结"],
        improvement: "补充具体使用情境",
        followUpQuestion: "如果没有手机，如何验证所有权？",
      }),
    },
    history: {
      upsert,
    },
  });

  await user.click(await screen.findByRole("button", { name: "结构化训练" }));
  await startRound(user);
  await user.type(screen.getByLabelText("你的联结"), "共享雨伞所有权");
  await user.click(screen.getByRole("button", { name: "评价我的答案" }));
  expect(await screen.findByText("跨领域明显")).toBeTruthy();
  expect(screen.getByRole("button", { name: "生成 3 个示例" })).toBeTruthy();
  expect(upsert).toHaveBeenCalledTimes(1);
});
```

- [x] **Step 3：运行测试确认失败**

```bash
pnpm test -- src/pages/tools/tests/creativity-tool.test.tsx
```

Expected: 新训练测试失败。

- [x] **Step 4：实现三级提示、评价和示例解锁**

规则：

- 第 N 级提示只有在前 N-1 级已成功后才可点击。
- 提示请求携带之前的提示，避免内容重复或越级。
- 空白答案不能提交评价。
- 评价成功后显示四维等级、理由、亮点、改进方向和追问。
- 评价成功后创建历史；生成示例后使用同一 historyId 更新。
- 训练模式在评价前不渲染示例按钮。

- [x] **Step 5：实现未提交答案换题确认**

当 `answerDirty` 为 true 且没有评价时，“换一组”先打开 `ConfirmDialog`。确认后中止当前请求、生成新 round ID 并清空答案；取消时状态不变。

- [x] **Step 6：运行训练模式测试**

```bash
pnpm test -- src/pages/tools/tests/creativity-tool.test.tsx
```

Expected: 全部通过。

- [x] **Step 7：提交训练模式**

```bash
git add src/pages/tools/creativity src/pages/tools/tests/creativity-tool.test.tsx
git commit -m "feat: add structured creativity training flow"
```

## Task 9：补齐异常测试、手动验收文档和全量验证

**Files:**

- Modify: `src/pages/tools/tests/creativity-tool.test.tsx`
- Modify: `src/pages/tools/tests/creativity-client.test.ts`
- Create: `.trellis/tasks/07-26-combinational-creativity-tool/manual-acceptance.md`

- [x] **Step 1：补充异常路径自动化测试**

在 `creativity-tool.test.tsx` 增加：

```tsx
it("preserves the prompt and answer after evaluation failure", async () => {
  const user = userEvent.setup();
  renderHarness({
    client: { evaluate: vi.fn().mockRejectedValue(new Error("invalid JSON")) },
  });
  await user.click(await screen.findByRole("button", { name: "结构化训练" }));
  await startRound(user);
  const answer = screen.getByLabelText("你的联结") as HTMLTextAreaElement;
  await user.type(answer, "共享雨伞所有权");
  await user.click(screen.getByRole("button", { name: "评价我的答案" }));
  expect(await screen.findByText("invalid JSON")).toBeTruthy();
  expect(screen.getByText("雨伞")).toBeTruthy();
  expect(answer.value).toBe("共享雨伞所有权");
  expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
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
  const generate = await screen.findByRole("button", { name: "生成组合" });
  await user.click(generate);
  await user.click(screen.getByRole("button", { name: "重新生成组合" }));
  expect(await screen.findByText("火山")).toBeTruthy();
  resolveFirst(prompt);
  await Promise.resolve();
  expect(screen.queryByText("雨伞")).toBeNull();
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
  await user.click(screen.getByRole("button", { name: "生成 3 个示例" }));
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
  expect(saveSettings).toHaveBeenCalledWith(
    expect.objectContaining({ modelId: "gateway/model" }),
  );
});
```

请求进行期间，原“生成组合”按钮的可访问名称固定为“重新生成组合”；点击后先 abort 旧请求，再创建新 round 并发起第二次请求。该行为同时满足用户主动取消和迟到响应保护。

- [x] **Step 2：运行全部自动化检查**

```bash
pnpm test
pnpm build
git diff --check
```

Expected:

- Vitest 全部通过。
- `tsc && vite build` 成功。
- `git diff --check` 无输出。

- [x] **Step 3：创建手动验收清单**

`manual-acceptance.md` 写入以下未勾选项目：

```markdown
# Manual Acceptance

- [ ] 远程模型：快速灵感能生成 2/3 个题目和三个不同方法的示例。
- [ ] 远程模型：训练模式能逐级提示、评价并在评价后解锁示例。
- [ ] 端侧模型：通过 Unified Gateway 完成同样的两个流程。
- [ ] 模型切换会被记住；删除当前模型后自动回退并提示。
- [ ] 网关停止后首次调用会按需启动。
- [ ] 网关启动失败时显示可恢复错误和统一网关入口。
- [ ] 评价失败后题目和答案不丢失，重试可以继续。
- [ ] 有未提交答案时换题需要确认。
- [ ] 最近记录最多 50 条，可查看、删除单条和清空。
- [ ] 历史写入失败不隐藏已生成结果。
- [ ] 中文界面请求中文结果，英文界面请求英文结果。
- [ ] 切换界面语言不会篡改已有历史内容。
```

- [ ] **Step 4：执行桌面端手动验收**

Run:

```bash
pnpm tauri:dev
```

逐项完成 `manual-acceptance.md`，只在真实验证后勾选。发现问题时回到对应任务先补失败测试，再修复。

- [ ] **Step 5：最终提交**

```bash
git add .trellis/tasks/07-26-combinational-creativity-tool/manual-acceptance.md src/pages/tools/tests
git commit -m "test: verify creativity training workflows"
```

## 验证汇总

自动化：

```bash
pnpm test
pnpm build
git diff --check
```

手动：

```bash
pnpm tauri:dev
```

质量门槛：

- PRD 的 15 项验收标准均能映射到自动化测试或手动验收项。
- 无未处理的 TypeScript、Vitest 或 Vite 错误。
- 远程模型与端侧模型至少各完成一次双模式闭环。
- 失败、取消和迟到响应不会覆盖新状态或清空用户答案。

## 风险与回滚点

- **结构化输出兼容性：** 若特定模型连续两次返回无效结构，仅禁用该次结果并保留重试，不回退到绕过校验的自由文本渲染。
- **统一网关回归：** 网关调用封装在 `client.ts`；可回滚工具 UI 而不修改 Agent Runtime 或上游 Provider 配置。
- **历史数据问题：** 历史使用独立 key 且未加入同步注册表；可清空 `creativityHistory` 而不影响聊天、模型或其他工具数据。
- **测试基础设施：** Vitest 仅影响开发依赖和测试命令；生产构建仍使用原有 `tsc && vite build`。
- **局部回滚顺序：** 先从 `ToolsPage` 移除 Tab，再删除 `src/pages/tools/creativity/`，最后删除 `src/lib/creativity/` 和独立历史 key；不需要 Rust 或数据库迁移回滚。

---

## 验收反馈改造（2026-07-26）

### Task 10：扩展 2-6 数量并阻止 AI 返回完整问题

**Files:**

- Modify: `src/lib/creativity/types.ts`
- Modify: `src/lib/creativity/prompts.ts`
- Modify: `src/lib/creativity/parser.ts`
- Modify: `src/pages/tools/creativity/state.ts`
- Modify: `src/pages/tools/tests/creativity-domain.test.ts`

- [x] **Step 1：先写失败测试**

```ts
it("accepts six short independent concepts", () => {
  const result = parseCreativityPrompt(
    '{"items":[{"text":"雨伞","kind":"thing"},{"text":"信任","kind":"concept"},{"text":"珊瑚","kind":"thing"},{"text":"节奏","kind":"concept"},{"text":"电池","kind":"thing"},{"text":"迁徙","kind":"concept"}]}',
    6,
  );
  expect(result.items).toHaveLength(6);
});

it("rejects questions and task instructions as combination items", () => {
  expect(() =>
    parseCreativityPrompt(
      '{"items":[{"text":"结合雨伞与手电筒的功能，列出至少十种新产品形态","kind":"concept"},{"text":"森林","kind":"thing"}]}',
      2,
    ),
  ).toThrow(/short phrase/i);
});
```

- [x] **Step 2：运行测试确认失败**

```bash
pnpm test -- src/pages/tools/tests/creativity-domain.test.ts
```

Expected: `6` 不满足旧 `2 | 3` 类型，且完整任务句未被拒绝。

- [x] **Step 3：实现数量与短语契约**

```ts
export type CreativityItemCount = 2 | 3 | 4 | 5 | 6;

const SENTENCE_PUNCTUATION = /[，。！？；：,!?;:\n\r]/u;

export function validateCombinationLabel(value: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    Array.from(normalized).length > 24 ||
    SENTENCE_PUNCTUATION.test(normalized)
  ) {
    throw new Error("Combination item must be a short phrase");
  }
  return normalized;
}
```

`buildPromptMessages` 明确要求每项是一个名词、事物名称或简短概念短语，禁止问题、任务指令、完整句子和多对象描述。

- [x] **Step 4：运行测试与类型检查**

```bash
pnpm test -- src/pages/tools/tests/creativity-domain.test.ts
pnpm exec tsc --noEmit
```

Expected: 全部通过。

- [x] **Step 5：提交**

```bash
git add src/lib/creativity src/pages/tools/creativity/state.ts src/pages/tools/tests/creativity-domain.test.ts
git commit -m "fix: constrain creativity prompts to short concepts"
```

### Task 11：重构响应式配置栏和自定义选择值

**Files:**

- Create: `src/pages/tools/creativity/PresetCustomSelect.tsx`
- Modify: `src/pages/tools/creativity/CreativityControls.tsx`
- Modify: `src/lib/creativity/types.ts`
- Modify: `src/i18n/locales/zh/pages.json`
- Modify: `src/i18n/locales/en/pages.json`
- Modify: `src/pages/tools/tests/creativity-tool.test.tsx`

- [x] **Step 1：先写失败测试**

```tsx
it("shows all five prompt controls and accepts a custom semantic distance", async () => {
  const user = userEvent.setup();
  renderHarness();
  expect(await screen.findByLabelText("组合数量")).toBeTruthy();
  expect(screen.getByLabelText("语义距离")).toBeTruthy();
  expect(screen.getByLabelText("主题领域")).toBeTruthy();
  expect(screen.getByLabelText("抽象层级")).toBeTruthy();
  expect(screen.getByLabelText("用途目标")).toBeTruthy();

  await user.click(screen.getByLabelText("语义距离"));
  await user.click(screen.getByRole("option", { name: "自定义…" }));
  await user.type(screen.getByLabelText("自定义语义距离"), "跨文化但功能相似");
  const input = screen.getByLabelText("自定义语义距离") as HTMLInputElement;
  expect(input.value).toBe("跨文化但功能相似");
});
```

测试使用原生 `HTMLInputElement.value` 断言，不依赖 jest-dom matcher。

- [x] **Step 2：运行测试确认失败**

```bash
pnpm test -- src/pages/tools/tests/creativity-tool.test.tsx
```

Expected: 现有按钮组和更多设置结构不满足五项同级与自定义输入。

- [x] **Step 3：实现通用预设/自定义选择器**

```ts
interface PresetCustomSelectProps {
  label: string;
  value: string;
  presets: Array<{ value: string; label: string }>;
  customLabel: string;
  customPlaceholder: string;
  onChange: (value: string) => void;
}
```

组件使用现有 Radix `Select`。当当前值不属于 presets 时，Select 值为 `__custom__` 并显示一个受控 `Input`；选择预设时直接写预设值。

- [x] **Step 4：实现响应式配置栏**

- 组合数量改为带 `aria-label` 的 Select，选项为 2-6。
- 语义距离常驻。
- 主题领域、抽象层级、用途目标在 `xl` 及以上同级展示。
- `xl` 以下显示“更多设置”，对话框复用同一个 `PresetCustomSelect`。
- 四个字符串字段均可保存预设值或自定义文本。

- [x] **Step 5：运行测试与构建**

```bash
pnpm test -- src/pages/tools/tests/creativity-tool.test.tsx
pnpm build
```

Expected: 全部通过。

- [x] **Step 6：提交**

```bash
git add src/pages/tools/creativity src/lib/creativity/types.ts src/i18n/locales
git commit -m "feat: add responsive custom creativity controls"
```

### Task 12：增加自定义组合来源

**Files:**

- Modify: `src/lib/creativity/types.ts`
- Modify: `src/pages/tools/creativity/state.ts`
- Modify: `src/pages/tools/creativity/CreativityControls.tsx`
- Modify: `src/pages/tools/creativity/CreativityTool.tsx`
- Modify: `src/pages/tools/creativity/CreativityWorkspace.tsx`
- Modify: `src/lib/creativity/history.ts`
- Modify: `src/i18n/locales/zh/pages.json`
- Modify: `src/i18n/locales/en/pages.json`
- Modify: `src/pages/tools/tests/creativity-domain.test.ts`
- Modify: `src/pages/tools/tests/creativity-tool.test.tsx`

- [x] **Step 1：先写 reducer 失败测试**

```ts
it("resizes the custom draft while preserving leading values", () => {
  const custom = creativityReducer(createInitialCreativityState(), {
    type: "source-changed",
    source: "custom",
  });
  const filled = creativityReducer(custom, {
    type: "custom-item-changed",
    index: 0,
    value: "雨伞",
  });
  const resized = creativityReducer(filled, {
    type: "options-changed",
    options: { ...filled.options, itemCount: 4 },
  });
  expect(resized.customItems).toEqual(["雨伞", "", "", ""]);
});
```

- [x] **Step 2：先写组件失败测试**

```tsx
it("creates a local four-item combination without calling AI generation", async () => {
  const user = userEvent.setup();
  const generatePrompt = vi.fn();
  renderHarness({ client: { generatePrompt } });
  await user.click(await screen.findByRole("button", { name: "自定义组合" }));
  await user.click(screen.getByLabelText("组合数量"));
  await user.click(screen.getByRole("option", { name: "4" }));
  const inputs = screen.getAllByLabelText(/组合词/);
  for (const [index, value] of ["雨伞", "信任", "珊瑚", "节奏"].entries()) {
    await user.type(inputs[index]!, value);
  }
  await user.click(screen.getByRole("button", { name: "使用此组合" }));
  expect(await screen.findByText("节奏")).toBeTruthy();
  expect(generatePrompt).not.toHaveBeenCalled();
});
```

- [x] **Step 3：运行测试确认失败**

```bash
pnpm test -- src/pages/tools/tests/creativity-domain.test.ts src/pages/tools/tests/creativity-tool.test.tsx
```

Expected: source 与 customItems 状态不存在。

- [x] **Step 4：实现来源和自定义草稿**

```ts
export type CombinationSource = "ai" | "custom";
```

状态增加 `source` 和 `customItems`。`options-changed` 根据 itemCount 扩展或裁剪草稿；自定义提交复用 `validateCombinationLabel`、空值和归一化去重校验，并在本地创建 `CreativityPrompt`。

- [x] **Step 5：接入 UI 与历史**

- 配置栏提供 `AI 生成 / 自定义组合` 切换。
- 自定义模式显示与数量一致的输入框。
- 自定义提交按钮为“使用此组合”。
- AI 模式继续显示“生成组合”。
- 历史记录增加 `source`，旧记录缺失时按 `"ai"` 读取。

- [x] **Step 6：运行测试与构建**

```bash
pnpm test
pnpm build
git diff --check
```

Expected: 全部通过。

- [x] **Step 7：提交**

```bash
git add src/lib/creativity src/pages/tools/creativity src/pages/tools/tests src/i18n/locales
git commit -m "feat: support custom creativity combinations"
```

### Task 13：重新验收并归档

- [ ] **Step 1：更新 `manual-acceptance.md`**

新增并实际验证：

```markdown
- [ ] AI 组合只返回独立词语或短语，不返回完整问题或任务。
- [ ] 五项配置在宽屏同级显示，窄屏低频项进入更多设置。
- [ ] 四个配置维度均可使用自定义文本。
- [ ] 自定义组合支持 2-6 个非空且不重复的词语。
```

- [ ] **Step 2：执行全量验证**

```bash
pnpm test
pnpm build
git diff --check
```

- [ ] **Step 3：用户验收通过后归档 Trellis 任务**
