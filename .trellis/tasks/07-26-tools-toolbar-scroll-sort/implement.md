# 实用工具栏滚动与排序实施计划

**Goal:** 让实用工具 Tab 栏在窄屏下可横向滚动，并支持用户拖拽调整工具顺序。

**Architecture:** `src/pages/tools/ToolsPage.tsx` 继续作为工具注册入口；新增同文件内的顺序归一化与本地存储辅助函数，避免拆出过早抽象。UI 使用项目已有 `@dnd-kit` 实现横向排序，顺序保存到 `localStorage`。

**Tech Stack:** React, Radix Tabs, @dnd-kit, Vitest, Testing Library.

---

## Task 1: 顺序归一化与测试

**Files:**
- Modify: `src/pages/tools/ToolsPage.tsx`
- Modify: `src/pages/tools/tests/tools-page.test.ts`

- [x] 写失败测试：覆盖默认顺序、移除未知 id、补齐新增工具。
- [x] 运行 `pnpm test -- src/pages/tools/tests/tools-page.test.ts`，确认测试因缺少辅助函数失败。
- [x] 实现 `normalizeToolTabOrder(order: readonly string[]): ToolTabValue[]`。
- [x] 再次运行同一测试，确认通过。

## Task 2: 本地持久化与重置

**Files:**
- Modify: `src/pages/tools/ToolsPage.tsx`
- Modify: `src/pages/tools/tests/tools-page.test.ts`

- [x] 写失败测试：覆盖 `loadToolTabOrder`、`saveToolTabOrder` 和 `resetToolTabOrder`。
- [x] 运行 `pnpm test -- src/pages/tools/tests/tools-page.test.ts`，确认失败点来自缺少持久化函数。
- [x] 使用 `llmtoolforge.tools.tabOrder` 作为 `localStorage` key，实现读取、保存和清除。
- [x] 再次运行同一测试，确认通过。

## Task 3: 单行滚动与拖拽排序 UI

**Files:**
- Modify: `src/pages/tools/ToolsPage.tsx`
- Modify: `src/pages/tools/tests/tools-page.test.ts`
- Modify: `src/i18n/locales/zh/pages.json`
- Modify: `src/i18n/locales/en/pages.json`

- [x] 写失败组件测试：渲染工具栏、点击重置按钮、模拟排序回调后顺序变化。
- [x] 运行 `pnpm test -- src/pages/tools/tests/tools-page.test.ts`，确认组件测试失败。
- [x] 将 Tabs 改为受控 `value`，按持久化顺序渲染 Tab。
- [x] 用 `DndContext`、`SortableContext`、`useSortable` 包裹 Tab 触发器。
- [x] 给 `TabsList` 外层增加水平滚动容器，保持单行不换行。
- [x] 增加重置顺序按钮及中英文文案。
- [x] 再次运行同一测试，确认通过。

## Task 4: 全量验证

- [x] 运行 `pnpm test -- src/pages/tools/tests/tools-page.test.ts`。
- [x] 运行 `pnpm build`。
- [x] 检查 `git diff`，确认只包含本任务相关改动和可视化伴侣临时忽略项。
