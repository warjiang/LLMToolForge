# Implementation Plan

按顺序执行，每步独立验证。遵循 TDD：先写失败测试，再实现最小逻辑。本任务同时改动
前端（React/TS）与后端（Rust），后端为主要新增面。所有决策以 `prd.md` 与
`design.md` 为准；关键取舍已在 design §17 固定（`set -e` 真实语义 + 优雅终止、
干净 Bash `--norc --noprofile`、`source_too_large=1 MiB`、`command-group` 为净新增依赖）。

统一验证命令：

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

仓库没有 lint script，不把 lint 写成完成条件。`vitest.config.ts` 使用显式
`test.include` 白名单；每个新测试文件或 glob 必须在同一任务中加入白名单，并从
`pnpm test` 输出确认 Shell Notebook 用例实际被收集执行。依赖 Bash 的 Rust 集成测试
按平台条件运行（`#[cfg(unix)]` 或运行时探测 `bash`），纯协议解析与状态机测试不依赖
外部 Shell，必须在所有平台通过。

## 复用与事实基线（已核对）

- 一次性沙箱执行 `run_sandboxed_command` 在 `src-tauri/src/lib.rs:118`，**仅参考**其
  结构化输出/错误表达，不复用其进程与权限语义。
- PATH 补齐：`src-tauri/src/proc_env.rs:33` `augmented_path()`，含
  `apply_to_tokio_command`。
- 流式事件参考 SSH 的 `Channel<T>` 模式：Rust `src-tauri/src/ssh/session.rs:20`，
  TS `src/lib/ssh/client.ts:294`。
- `stripAnsi`：`src/lib/utils.ts:51`。
- 本地草稿存储：`src/data/storage.ts:71` `getStore()`（Tauri Store ↔ localStorage 回退）。
- 确认对话框：`src/components/common/ConfirmDialog.tsx`。
- 工具页与可排序标签：`src/pages/tools/ToolsPage.tsx`（`TOOL_TAB_ORDER` /
  `TOOL_TAB_ORDER_KEY` / `normalizeToolTabOrder`）。
- 保存对话框 + 后端写文本：`src/lib/modelConfigIo.ts:152`（`save`）+
  `src-tauri/src/config_io.rs:12` `model_config_export`。
- 同步注册面（本任务**刻意不触碰**，草稿不入云同步）：`src/data/sync/registry.ts:22`
  与 `src/store/index.ts:50`。
- `command-group` **当前不在** `src-tauri/Cargo.toml`（现为 `wait-timeout = "0.2"`），
  属净新增依赖。

依赖关系：

```text
T0 ─┬─ T1 ─────────────┐
    ├─ T2 ──────────┐  │
    └─ T3 ─┬─ T4 ─ T5 ─┴──┐
           └───────────┐  │
T1 ─ T6 ───────────────┴─ T7 ─ T8 ─ T9 ─ T10
T2 ────────────────────────┘        │
T5 ─────────────────────────────────┘
```

- 可并行：T1 / T2 / T3 在 T0 后可并行；T6 依赖 T1；T4 依赖 T3。
- 关键路径：T0 → T3 → T4 → T5 → T7 → T8 → T9 → T10。
- T7（控制器/store）汇聚 T1、T2、T5、T6。
- T9（导出落盘）依赖 T2 的 Markdown 生成与 T8 的工具栏入口。

## T0 — 依赖引入与脚手架

1. 后端：`cargo add command-group --manifest-path src-tauri/Cargo.toml`，以解析出的
   实际版本 pin（不假定 `5.0.1`），并启用其 tokio 集成 feature（以该版本实际 feature
   名为准，配合 `tokio::process`）。若版本/feature 与预期不符，先在本步记录并调整
   `design.md`，不硬套。
2. 前端：加入 CodeMirror 6 依赖 `@uiw/react-codemirror`、`@codemirror/legacy-modes`
   （及其必要 peer）。不引入 Monaco/Shiki/Prism。
3. 新建空模块目录 `src-tauri/src/shell_notebook/`（`mod.rs` 占位）并在
   `src-tauri/src/lib.rs` 声明 `mod shell_notebook;`。
4. 验证：`cargo check`、`pnpm build` 基线通过；确认 `command-group` 与 tokio feature
   编译可用。

## T1 — 前端类型与草稿 schema（TDD）

1. `src/types`（或就近的 shell notebook feature 目录）定义 `ShellNotebookDraftV1`
   （`version:1`、`cells:{id,source}[]`、`startDirectory`）与运行时 `CellRuntime`、
   `CellRunStatus`（`idle|queued|running|success|failed|cancelled|session-lost`）。
2. 纯函数 `normalizeShellNotebookDraft`：版本校验、损坏数据回退到“单个空单元格 +
   空 startDirectory”、至少保留一格、去除非法字段。
3. 先添加校验测试，再更新 `vitest.config.ts` 的 `test.include` 收集该文件。
4. 验证：版本/损坏回退、至少一格、字段归一化测试通过；`pnpm exec tsc --noEmit`。

## T2 — TS IPC 客户端、事件 reducer 与 Markdown 生成（TDD）

1. 新建 `src/lib/shellNotebook.ts`：前后端 payload 类型、`ShellNotebookEvent` 联合、
   桌面端检测（复用 `isTauri()`），以及基于 `Channel<T>` 的 open/execute/stop/
   restart/close 封装（参考 `src/lib/ssh/client.ts`）。浏览器模式不调用 Tauri，
   返回 `desktop_only`。
2. 事件 reducer（纯函数）：按 `runId` 归一化 stdout/stderr 追加、`runFinished` 写入
   退出码/耗时/当前目录、`runCancelled` 置 `cancelled`、`sessionTerminated` 置
   `session-lost`；**忽略过期 runId**；`error` 按 `code` 保留 message。区分“单元格
   失败（非零退出码）”与“会话失效”。
3. Markdown 生成 `buildShellNotebookMarkdown(cells)`：忽略仅空白单元格、每个非空
   单元格独立 ` ```shell ` 代码块、块间一个空行、不含输出/元数据；源码含连续反引号时
   围栏长度大于最长连续反引号。
4. 先加单测并登记 `vitest.config.ts`：reducer 各事件与过期 runId、session-lost 与
   failed 区分、Markdown 跳空/反引号围栏/顺序、浏览器模式 `desktop_only`。

## T3 — Rust 会话管理器骨架与结构化错误

1. `src-tauri/src/shell_notebook/` 建立 `ShellNotebookManager`（Tauri `State`）、
   `ShellSession` 结构（child/stdin/process_scope/active_run/channel/start_directory/
   current_directory/protocol_token/temp_directory）。
2. 稳定错误码枚举，序列化为 `{ code, message }`：`desktop_only`、`bash_not_found`、
   `invalid_working_directory`、`session_not_found`、`session_busy`、`source_too_large`、
   `spawn_failed`、`stdin_write_failed`、`protocol_lost`、`session_terminated`、
   `export_failed`。绝不 panic 或返回原始字符串/HTML。
3. 定义并注册 IPC 命令（`src-tauri/src/lib.rs` 的 `invoke_handler`，参考现有 SSH/
   config_io 注册位置）：`shell_notebook_open/execute/stop/restart/close`，事件用
   `Channel<ShellNotebookEvent>`。
4. Bash 解析：macOS/Linux 走 PATH；Windows 探测 Git Bash，找不到返回 `bash_not_found`，
   不回退其它 shell。
5. 验证：`cargo check`；命令可被前端 `invoke` 找到；错误序列化形状测试通过。

## T4 — 执行协议与输出分帧（TDD，核心）

1. 启动干净非交互 Bash：`--norc --noprofile`，`proc_env::augmented_path()` 补 PATH，
   `shopt -s expand_aliases`，在配置目录（未选择则解析系统 `$HOME`）以当前桌面用户
   权限启动。不调用 `sandbox-exec`。
2. 执行流程（design §7.2）：校验 session/runId/busy/源码大小（`>1 MiB`→
   `source_too_large`）→ 写唯一 `ltf-shellnb-*.sh` → 向 stdin 写受控 wrapper →
   wrapper `source` 脚本 → 捕获退出码写 `LTF_LAST_EXIT_CODE` → 读取当前目录并
   **base64 编码** → 向 stdout 与 stderr 各写带随机会话 token 的完成帧 → 双流均到齐
   后发 `runFinished(currentDirectory)` → 删除临时脚本。
3. **并发读取硬契约**：写 stdin 之前先启动独立 stdout/stderr 异步读取任务并持续排空，
   杜绝“写 stdin 同时 Bash 阻塞在满管道”的死锁。
4. 输出：stdout/stderr 分流；每次运行上限 2 MiB，达上限后继续排空但停写前端状态并置
   `truncated`；非 UTF-8 有损转换；不做 ANSI 仿真。
5. 先写并登记测试（`#[cfg(unix)]` / 运行时探测 bash）：完成帧跨 chunk/同 chunk/多次
   输出解析、双完成帧才结束、base64 目录含空格换行 Unicode、变量/`cd`/函数/alias/
   shell option 跨单元格保留、非零退出码与 `$?`/`LTF_LAST_EXIT_CODE`、语法错误不误报
   成功、2 MiB 截断后仍排空、大输出下 stdin 写入不阻塞。纯解析/状态机测试不依赖 bash。

## T5 — 生命周期、取消与会话失效（TDD）

1. 用 `command-group` 的 `GroupChild` 让 Bash 及后代处于可整树终止范围（Unix 进程组 /
   Windows Job）。
2. Stop 语义（design §9）：终止整棵进程树 → 当前单元格 `cancelled` → 用相同配置自动
   重启新会话 → 事件带 `stateReset:true` → 保留源码与已有输出。
3. 会话 watcher：检测进程退出或完成帧缺失发 `sessionTerminated`。**`set -e` 触发的
   会话退出走同一路径**（真实语义，不隔离）：前端置 `session-lost`，保留源码/输出，
   提供一键重启，UI 区分“单元格失败”与“会话失效”。
4. busy 会话拒绝第二次执行返回 `session_busy`；页面卸载/应用退出清理整棵进程树与临时
   目录；切换启动目录必须重启会话。
5. 临时文件：固定前缀 `ltf-shellnb-*`；Manager 初始化对系统临时目录 best-effort 扫描
   清理历史遗留。
6. 测试并登记：stop 后 Bash 及子进程均退出且新会话状态为空、`set -e` 致会话退出发
   `sessionTerminated`、busy 拒绝、页面卸载/退出不残留子进程、临时脚本在成功/失败/
   会话退出/崩溃遗留后清理、Shell 主动 `exit` 触发清理。

## T6 — CodeMirror 单元格编辑器

1. `ShellCellEditor`：`@uiw/react-codemirror` + `@codemirror/legacy-modes/mode/shell`
   经 `StreamLanguage` 提供 Bash 高亮；受控 `value`/`onChange`，暴露聚焦/选区 ref。
   仅需高亮、缩进、撤销、行号、基础括号，不做补全/LSP。
2. 运行中锁定源码编辑，运行结束后可继续编辑。
3. **测试策略（design §11.1）**：为组件测试提供轻量 mock（`__mocks__` 或
   `vi.mock`），仅暴露受控 value/onChange 与 ref；只在极少数用例真正渲染 CM，避免
   jsdom 下变脆变慢。登记相关测试文件到 `vitest.config.ts`。

## T7 — 控制器/Store 与执行编排（TDD）

1. feature-local Zustand（或 hook）`useShellNotebook`：单元格增删/排序（至少一格）、
   草稿通过 `getStore()` 版本化 key 自动保存（仅 source/order/startDirectory，
   **不入 Repository、不注册同步**）、运行时状态仅在内存。
2. 执行编排：单格“运行”用当前 Shell 状态跑当前源码快照并递增 execution count；
   “全部运行”按点击时页面顺序建队列串行执行，遇首个非零退出码停止且其后队列保持
   未执行；**队列中途会话失效（`set -e` 退出、`exit`、进程消失）也立即终止队列**，
   其后队列项保持未执行并显示会话失效；编辑已执行单元格标记“结果已过期”但保留旧
   输出；**实际执行顺序与页面顺序解耦**（移动/删除前序不自动重跑）。
3. 事件订阅接 T2 reducer；停止/重启/关闭走 T5。
4. 测试并登记：草稿归一化与损坏回退、增删排序保底一格、执行顺序与页面顺序解耦、
   Run All 串行/失败停止/取消清队列、编辑后标记旧输出、reducer 忽略过期 runId、
   命令仅在显式执行时运行（打开/恢复/编辑不自动执行）。

## T8 — 页面 UI、工具栏与 i18n

1. 在 `src/pages/tools/ToolsPage.tsx` 的 `TOOL_TAB_ORDER` 追加 Shell Notebook 标签；
   确认 `normalizeToolTabOrder` 对旧 localStorage 顺序兼容（缺失项追加）。内容在
   `ToolsPage` 生命周期内保持挂载，切其它工具标签不终止会话；离开 `/tools` 或关闭
   应用时关闭会话。
2. 单层顶部工具栏：当前工作目录、文件夹选择、会话状态、运行全部、重启、导出、清空
   工作区。切换启动目录且已有 execution count 时用 `ConfirmDialog` 确认重启。
3. 单元格列表：执行序号、运行按钮、编辑器、单元格菜单；输出在下方，stdout 普通前景、
   stderr 错误色但不等同失败，成功/失败由退出码决定；输出可复制/清空/折叠；拖拽排序
   + 上下移动键盘可达；输出变化不引起布局跳动。
4. 快捷键：`Shift+Enter` 运行并聚焦下一格、`Cmd/Ctrl+Enter` 运行并保持焦点；不替代
   可见按钮。
5. 浏览器开发模式显示桌面端限制，不发无意义执行请求。空状态明确提示“干净 Bash，
   不加载个人 rc（`--norc --noprofile`）”。
6. 所有可见文案（标签、状态、错误、空状态、确认、干净 Bash 提示）加入中英文 locale，
   不硬编码；错误按 code 翻译并保留 message 作诊断。
7. 添加组件测试并登记白名单：标签顺序兼容旧 localStorage、浏览器模式桌面限制、
   状态区分（等待/运行/成功/失败/取消/会话失效）、快捷键、确认重启、干净 Bash 提示。

## T9 — Markdown 导出落盘

1. 前端用 `@tauri-apps/plugin-dialog` `save`（参考 `src/lib/modelConfigIo.ts:152`），
   默认文件名 `shell-notebook-YYYYMMDD-HHmm.md`，内容来自 T2 的
   `buildShellNotebookMarkdown`。
2. 后端写文件：新增 `shell_notebook_export_markdown(path, contents)` 走
   `fs::write`（参考 `src-tauri/src/config_io.rs:12`）；**不经沙箱**的
   `fs_tools::fs_write`。失败返回 `export_failed`。
3. 测试并登记：空白单元格忽略、反引号围栏、顺序、导出不含输出/元数据；后端写失败
   返回结构化 `export_failed`。

## T10 — 集成、跨平台与验收

1. 端到端串起 open → execute（流式）→ stop → restart → 目录切换 → 导出；确认状态
   继承、`cd` 后 UI 显示实际目录、重启回到配置启动目录。
2. 跨平台：macOS 自带 Bash 3.2 下 wrapper 不依赖 Bash 4+ 特性、`expand_aliases`
   行为正确；Windows/Git Bash 下临时 `.sh` 路径与写入 stdin 的 wrapper 不被 MSYS
   路径改写或 CRLF 破坏，找不到 Bash 返回 `bash_not_found`。
3. 从 `pnpm test` 与 `cargo test` 输出确认所有新测试文件均被收集，不只看退出码。
4. 逐项核对 `prd.md` Acceptance Criteria（含 `set -e` 会话失效、干净 Bash、草稿不
   入云同步、未点击不执行）。
5. 运行全量验证命令：`pnpm test`、`pnpm exec tsc --noEmit`、`pnpm build`、
   `cargo test`、`cargo check`。

## Manual Acceptance

结果记录到本任务的 `manual-acceptance.md`（需在 Tauri dev 模式手工验证）：

- 长时间运行命令持续流式输出、不自动超时，可被 Stop 终止并自动重启；
- 变量/`cd`/函数/alias/`set -o` 跨单元格保留；`cd` 后顶部显示实际目录，重启回到
  启动目录；
- `set -e` 后执行失败命令 → 会话标 `session-lost`、源码与输出保留、一键重启可继续；
  UI 明确区分“单元格失败”与“会话失效”；
- Run All 遇首个非零退出码停止，其后单元格保持未执行；
- 大输出（>2 MiB）截断且不卡死，管道持续排空；
- 切换启动目录在已有 execution count 时确认重启；
- 导出 Markdown 仅含按顺序的非空 `shell` 代码块，无输出/元数据，含反引号源码围栏正确；
- 浏览器开发模式显示桌面端限制，不发执行请求；
- 应用重启后恢复源码/顺序/启动目录，不恢复输出/退出码/Shell 状态；
- Windows 无 Bash 时明确提示不可用。

## Rollback Points

- T0：撤回 `command-group` 与 CodeMirror 依赖即回到基线（其余步骤尚未接线）。
- T8：从 `TOOL_TAB_ORDER` 移除标签即隐藏入口，不影响本地草稿数据与其它工具；
  `normalizeToolTabOrder` 会自动忽略遗留顺序项。
- T9：移除导出命令与按钮不影响执行链路。
- 全局：本功能不注册任何同步资源，回退不涉及 `registry.ts` / `syncedCollectionStores`，
  不影响云同步与既有实体。
