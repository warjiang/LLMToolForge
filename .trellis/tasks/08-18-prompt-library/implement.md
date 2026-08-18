# Implementation Plan

按顺序执行，每步独立验证。遵循 TDD：先写失败测试，再实现最小逻辑。后端
（Rust）预期无改动；v1 不提供预置 Prompt，不实现 seed、marker 或特殊 ID。

统一验证命令：

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

仓库没有 lint script，不把 lint 写成完成条件。`vitest.config.ts` 使用显式
`test.include` 白名单；每个新测试文件或 glob 必须在同一任务中加入白名单，并从
`pnpm test` 输出确认 Prompt 用例实际被收集执行。

依赖关系：

```text
T0 ─┬─ T1 ───────────────────────────────┐
    └─ T2 ─┬─ T3                         │
           ├─ T4 ───────────────┐        │
           └─ T5 ───────────────┴─ T6 ─ T7 ─ T8(可延后) ─ T9
```

- 可并行：T1 与 T2；T3、T4、T5 在 T2 后可并行。
- 关键路径：T0 → T2 → T5 → T6 → T7 → T9。
- T6 同时依赖 T1、T2、T4、T5。
- T8 是会话标题增强，可延后；延后时 T7 直接进入 T9。

## T0 — 类型、校验与测试收集前置

1. `src/types/index.ts` 增加 `PromptTemplate extends BaseEntity`
   （`name/description/content/tags/sourceUrl?/favorite`）。
2. 新建纯函数 `normalizePromptInput`：trim name/content、tags 去空并按大小写
   不敏感去重、`sourceUrl` 仅允许 http/https。
3. 先添加校验测试，再更新 `vitest.config.ts` 的 `test.include`，确保测试被收集。
4. 验证：必填 name/content、tag 归一化、URL 校验测试通过；运行
   `pnpm exec tsc --noEmit`。

## T1 — applyPromptTemplate 纯函数（TDD）

1. 新建 `src/lib/prompt/applyPromptTemplate.ts`：
   `applyPromptTemplate(template, { text, selectionStart, selectionEnd })` 返回
   `{ text, selectionStart, selectionEnd, titleHint? }`。
2. 空框判定统一为 `text.trim().length === 0`。
3. 实现三规则：
   - Rule 1：空或仅空白 → 模板覆盖全文；有占位符时选中第一个，否则光标到末尾。
   - Rule 2：非空且含 `{{input}}` → 原全文替换所有占位符，结果覆盖输入框。
   - Rule 3：非空且无占位符 → 在光标/选区插入，保留前后文。
4. 先添加单测并登记到 `vitest.config.ts`：空白输入、三规则、Rule 2 与光标无关、
   多占位符、选区替换、`titleHint`、多行与 Unicode 偏移。

## T2 — Repository、Store、同步注册与基础 i18n

1. `src/data/repositories.ts` 新增：
   `new Repository<PromptTemplate>("promptTemplates", "prompt")`。
2. `src/store/index.ts` 导出 `usePromptStore`。
3. `src/data/sync/registry.ts` 注册 `promptTemplates` 资源。
4. 中英文 `pages` locale 增加同步资源名称，以及后续 Prompt UI 共用的基础文案。
5. 验证：普通 CRUD 与 tombstone 复用现有 Repository 行为；Settings 资源列表显示
   Prompt 项；远端 key 为 `resources/promptTemplates.json.enc`。

## T3 — 同步、快照与恢复刷新

1. 把 `usePromptStore` 加入 `src/store/index.ts` 的
   `syncedCollectionStores`。
2. 增加同步测试并登记 `vitest.config.ts`：
   - create/edit/favorite/delete 与 tombstone 合并；
   - 不同 ID 合并、同 ID 按 `updatedAt` LWW；
   - 成功写出的快照包含 Prompt payload；
   - 快照写失败仍保持 primary sync 成功；
   - restore 后 `reloadSyncedData()` 刷新 Prompt store。
3. 不改变现有 best-effort snapshot 语义。

## T4 — 应用进程级最近使用

1. 建立 feature-local、非持久化的 transient Zustand store，保存最多 5 个
   `recentPromptIds`；不复用或修改同步实体。
2. 提供纯更新/投影逻辑：
   - 重复 ID 移到最前；
   - 超过 5 个截断；
   - 已删除 ID 从展示结果过滤；
   - 收藏项不在最近分段重复显示。
3. 单测确认选用 Prompt 不调用 repository `edit`，不改变 `updatedAt`，重新启动应用
   后 recent 为空。

## T5 — PromptEditor 与 PromptManagerDialog

1. `PromptEditor`：name/description/content/tags/sourceUrl/favorite，复用 T0 校验。
2. `PromptManagerDialog`：左侧搜索列表、右侧编辑器；create/edit/favorite/delete；
   每次删除都使用现有 `ConfirmDialog`。
3. 首次为空库时提供明确的创建入口；保存失败保留编辑值并显示错误。
4. 所有标签、错误、空状态和确认文案加入中英文 locale，不硬编码可见文案。
5. 添加组件测试并登记 `vitest.config.ts`：空状态创建、字段校验、保存失败保值、
   删除确认、CRUD 后列表刷新。

## T6 — PromptPicker

1. 基于现有 `DropdownMenu` 组件实现，不新增 UI 依赖：
   - 打开后搜索框自动聚焦；
   - 空查询显示收藏与最近分段，空段不渲染；
   - 最近分段排除已在收藏分段出现的 Prompt；
   - 非空查询显示单一过滤列表；
   - 搜索仅匹配 name/description/tags，不匹配 content；
   - 结果按 favorite 降序、name 的 localeCompare 升序排列。
2. 空库仍显示 “Manage Prompts” 命令。
3. 支持上下键、Enter、Esc；Esc 不改 composer，套用后焦点返回 textarea。
4. 选行执行：读取 composer/选区 → T1 展开 → 关闭 picker → 返回应用结果 →
   T4 更新 recent。
5. 添加组件测试并登记白名单：过滤范围、确定性排序、分段去重、MRU 上限、
   Enter/Esc、焦点与 a11y。

## T7 — Composer 集成与 Store 初始化

1. `AgentChatView` 现有初始化 effect 中调用
   `usePromptStore.getState().load()`；Picker 覆盖 loading/error/empty/loaded 状态。
2. Skills/MCP 旁添加 Prompts 按钮，使用 lucide book/library 图标；对所有模型可用，
   不按输出模态禁用。
3. 给 composer `<Textarea>` 增加 ref；apply 前读取选区，状态提交后通过
   `useLayoutEffect` 执行 `setSelectionRange` 与 `focus()`。
4. `AgentChatView` 仅持有 picker/manager 开关、composer 写回和可选 `titleHint`；
   Prompt 管理逻辑留在独立组件。
5. 添加集成组件测试并登记白名单：store 初始化、四种加载状态、选区恢复、
   多模态模型可用、附件能力不受影响、长文本不破坏工具栏。

## T8 — 会话标题 titleHint（可延后）

1. `src/store/chat.ts` 的 `addMessage` 输入增加 transient `titleHint?`，传给
   `chatRepo.createMessage` 前显式剔除，确保不成为持久化消息字段。
2. 仅首条用户消息且 hint 非空时，用 hint 调用 `titleFromFirstMessage`。
3. Prompt 应用时设置 hint；首次手动 onChange 或 send 后清除。
4. 验证：写问题后套用模板时标题来自原问题；空框先套用时回退现有 28 字截断。

## T9 — 集成、回归与验收

1. 测试 Prompt 展开消息走 direct chat、Pi 和外部 Agent 的既有路径；持久化消息
   等于可见 composer 文本；源 Prompt 编辑/删除后 retry 仍使用已持久化文本。
2. 测试 manifest 不含 Prompt 正文或 source URL；加密 resource 与成功写出的
   snapshot 包含完整 Prompt payload。
3. 从 `pnpm test` 输出确认所有 Prompt 测试文件均被收集，不只检查退出码。
4. 逐项核对 `prd.md` Acceptance Criteria。
5. 运行全量验证命令：`pnpm test`、`pnpm exec tsc --noEmit`、`pnpm build`。

## Manual Acceptance

结果记录到本任务的 `manual-acceptance.md`：

- 新安装为空库，可从 Picker 直接进入管理并创建第一条 Prompt；
- 空字符串与仅空白输入都走 Rule 1；
- 写问题→套用、套用→填空、光标/选区插入符合三规则；
- 收藏与最近分段无重复，MRU 最多 5 条，重启后 recent 清空；
- 图文生成模型下按钮可用，套用后仍可添加图片；
- 多终端交替编辑、收藏、删除后同步一致；
- snapshot 写失败不影响 primary sync，成功 snapshot 含 Prompt；
- 快照恢复后 picker 无需重启即刷新。

## Rollback Points

- T2/T3：删除 registry 与 `syncedCollectionStores` 两处注册可完整撤回持久化接入。
- T6/T7：移除 Composer 入口不会影响已存 Prompt 数据或现有发送链路。
- T8：可独立延后或撤回，回退到现有首消息 28 字标题。
