# 组合式创造思维训练工具：技术设计

## 1. 设计目标

在现有“实用工具”页面增加一个 AI 原生的“创意联结”Tab，通过随机组合不相关事物，提供快速灵感与结构化训练两种使用方式。

设计必须满足以下原则：

- 两种模式共享同一套出题、模型调用和历史能力。
- 所有 AI 调用统一经过本地 Unified API Gateway。
- 用户主动触发每次模型调用，界面明确展示当前进度与结果。
- 模型返回必须经过运行时校验，错误不能破坏当前题目或用户答案。
- MVP 保持前端主导、本地单用户，不新增后端服务。

## 2. 产品结构

### 2.1 页面入口

在 `ToolsPage` 的 Tab 列表与 `TOOL_TAB_ORDER` 中增加 `creativity`。工具作为独立组件加载，不新增一级路由或侧边栏入口。

### 2.2 主界面

界面从上到下分为四个区域：

1. 工具栏：模式切换、模型选择、最近记录入口。
2. 出题设置：组合数量、语义距离、更多设置、生成组合按钮。
3. 当前题目：展示 2 或 3 个词语/事物，并提供“换一组”。
4. 模式工作区：快速灵感的示例区，或结构化训练的作答、提示、评价与示例区。

组合数量和语义距离常驻显示。主题领域、抽象层级和用途目标放入“更多设置”，均有无需修改即可使用的默认值。

## 3. 模式流程

### 3.1 快速灵感

1. 用户生成一组题目。
2. 用户主动点击“生成 3 个示例”。
3. 模型返回三个采用不同联结机制的示例。
4. 结果成功后创建本地历史记录。
5. 用户可整体重新生成示例或更换题目。

每个示例展示方法、标题和正文。方法由模型根据实际内容命名，但三项不得重复或只是措辞变化。

### 3.2 结构化训练

1. 用户生成一组题目并填写答案。
2. 用户可逐级解锁提示：观察问题、联结方向、半成品框架。
3. 用户提交答案后，模型返回四维评价、整体亮点、改进方向和追问。
4. 评价成功后创建本地历史记录，并解锁示例入口。
5. 用户生成示例后，更新当前历史记录。

模式切换保留当前题目，清空模式专属结果。存在未提交答案时更换题目需要确认。

## 4. 前端边界

### 4.1 UI 组件

建议新增 `src/pages/tools/CreativityTool.tsx` 作为容器组件，并按实际体量拆出以下展示组件：

- `CreativityControls`：模式、模型与出题参数。
- `CombinationPromptCard`：当前组合与换题操作。
- `InspirationWorkspace`：三个示例卡。
- `TrainingWorkspace`：答案、提示、评价与解锁后的示例。
- `CreativityHistoryDialog`：最近记录列表和详情。

容器通过 reducer 管理当前轮状态。异步操作使用明确的 operation 类型，避免多个请求并发写入同一结果。

### 4.2 领域模块

建议新增 `src/lib/creativityTool.ts`，负责：

- 领域类型和枚举。
- 出题、提示、示例和评价的提示词构造。
- 统一网关调用编排。
- JSON 文本提取、类型守卫和业务约束校验。
- 一次格式修复重试。

UI 不直接拼接提示词，也不直接断言模型返回类型。

### 4.3 历史模块

建议新增 `src/lib/creativityHistory.ts`，通过现有 `getStore()` 保存：

- 上次选择的模型和出题设置。
- 最多 50 条最近记录。

历史不注册到数据同步资源中。写入采用当前轮 ID upsert，避免评价和后续示例分别生成两条记录。

## 5. 数据契约

### 5.1 出题参数

```ts
interface CreativityPromptOptions {
  itemCount: 2 | 3;
  semanticDistance: "near" | "cross-domain" | "far";
  domain: "any" | string;
  abstraction: "concrete" | "abstract" | "mixed";
  purpose: "divergent" | "product" | "story" | "problem-solving";
}
```

### 5.2 题目

```ts
interface CreativityPrompt {
  id: string;
  items: Array<{
    text: string;
    kind: "thing" | "concept";
  }>;
}
```

校验要求：数量准确、文本非空、忽略大小写和空白后无重复。

### 5.3 提示与示例

```ts
interface CreativityHint {
  level: 1 | 2 | 3;
  content: string;
}

interface CreativityExample {
  method: string;
  title: string;
  content: string;
}
```

示例结果必须恰好三项，`method` 归一化后不得重复。

### 5.4 评价

```ts
type EvaluationLevel = "starting" | "clear" | "strong";

interface EvaluationDimension {
  level: EvaluationLevel;
  reason: string;
}

interface CreativityEvaluation {
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
```

等级在界面中本地化显示。模型必须提供每项理由，不生成百分制总分。

### 5.5 历史记录

历史记录保存模式、模型 ID、出题参数、题目、用户答案、已解锁提示、示例、评价和创建/更新时间。只保存规范化数据，不保存原始模型响应、内部提示词或推理内容。

## 6. AI 调用链

1. 初始化 `useUnifiedStore` 并 hydrate models。
2. 过滤被禁用及非文本生成模型，恢复上次模型；失效时选择第一个可用模型。
3. 调用前确认 Unified Gateway 正在运行，必要时按需启动。
4. 使用 exposed model id、网关端口和本地 bearer key 请求 OpenAI 兼容聊天端点。
5. 根据当前界面语言构造 system/user messages。
6. 解析并校验严格 JSON 结果。
7. 格式无效时进行一次仅修复格式的重试；业务语义仍无效则返回可重试错误。

每项操作是独立请求，不维护隐藏聊天上下文。后续操作显式携带当前题目、设置、已有提示或用户答案，保证请求可重试、可测试。

## 7. 状态与并发

当前轮至少包含：

- 当前模式与出题设置。
- 当前模型。
- 当前题目。
- 用户答案与 dirty 状态。
- 已解锁提示。
- 示例与评价。
- 当前异步 operation 和错误。
- 对应历史记录 ID。

同一时间只允许一个 AI operation。新一轮、模式切换或组件卸载时中止旧请求，并用 round ID 防止迟到响应覆盖新状态。

## 8. 错误处理

- 网关启动失败：展示原因和统一网关入口。
- 无可用模型：展示空状态和模型管理入口。
- 模型被移除：自动回退到其他可用模型并提示。
- 网络或模型失败：保留当前题目、答案和已成功结果，允许重试。
- JSON 无效：自动修复一次；仍失败则展示结构化输出错误。
- 历史写入失败：保留屏幕结果，提示本轮未保存。
- 用户主动取消：静默停止，不显示错误。

## 9. 国际化

新增中英文界面文案。提示词要求模型使用当前界面语言输出。历史记录保留生成时语言，切换界面语言后只翻译 UI 标签，不自动翻译历史内容。

## 10. 测试策略

### 单元测试

- 各类提示词包含完整参数和语言要求。
- JSON 提取支持纯 JSON 与 Markdown 代码块。
- 所有返回类型和业务约束被正确校验。
- reducer 拒绝迟到响应和非法状态转换。
- 模型选择能恢复、回退并排除不可用模型。
- 历史 upsert、单条删除、清空和 50 条截断正确。

### 组件测试

- 双模式切换和专属区域显示正确。
- 训练模式提交前不显示示例。
- 三级提示按顺序解锁。
- 未提交答案换题触发确认。
- 请求失败后题目和答案保持。
- 历史记录可查看和删除。

### 手动验收

- 远程模型跑通快速灵感和结构化训练。
- 统一网关中的端侧模型跑通相同流程。
- 模型切换、自动回退、失败重试与请求取消符合预期。
- 中文和英文界面及模型输出语言正确。

## 11. 范围外

- 完全无模型的本地随机词库。
- 自定义词库。
- 多轮追问对话。
- 成长趋势、签到、排行榜和社区分享。
- 跨设备历史同步。
