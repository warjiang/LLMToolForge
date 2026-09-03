# Shell Notebook 实用工具技术设计

## 1. 结论

该需求合理，且与现有“实用工具”定位一致。它解决的不是“再做一个终端”，而是补足终端在反复修改、多段执行、结果对照和最终整理方面的不足。

推荐首版采用：

- 长驻、非交互式 Bash 会话；
- 每个单元格在同一 Bash 进程中通过 `source` 执行；
- stdout/stderr 流式回传并归属到本次单元格运行；
- 状态按实际执行顺序继承；
- 以当前桌面用户权限直接作用于本机环境，不接入 Agent 沙箱；
- 源码本地自动保存，输出仅保留在内存；
- Markdown 只导出源码；
- 首版支持流式输出和不限时长运行，但不提供 PTY、stdin 交互、SSH 或多内核并行。

该方案总体复杂度为中高。难点集中在后端会话协议、进程退出与取消、输出边界和跨平台行为；编辑器与导出本身复杂度较低。

## 2. 问题边界

### 2.1 要解决的问题

开发者需要反复调整一组 Shell 指令，并在同一上下文中逐段验证。终端历史只能回看和重新提交整行命令，不能稳定表达多段脚本、执行结果与可继续编辑的源码之间的关系。

### 2.2 不做完整终端

Notebook 与终端的核心交互模型不同：

- Notebook 以有边界的脚本单元为输入；
- 同一时刻只执行一个单元格；
- 输出属于一次明确的运行；
- 页面顺序与实际执行顺序可以不同；
- 最终产物是可读的脚本文档，而不是终端录屏。

因此首版不引入终端提示符、光标控制、全屏 TUI、密码输入或任意 stdin 交互。
命令不设置自动超时；需要等待 stdin 的命令会保持运行，直到用户点击停止并触发会话重启。

## 3. 方案比较

### 3.1 方案 A：长驻非交互式 Bash

后端启动一个 stdin/stdout/stderr 均为管道的 Bash 进程。每次运行先将单元格写入临时 `.sh` 文件，再让长驻 Bash `source` 该文件。

优点：

- 变量、`cd`、函数、alias 和 shell option 保留在真实 Shell 进程中；
- stdout 与 stderr 可以分别采集；
- 不需要重放历史命令，避免重复副作用；
- 与现有 Rust 子进程和 Tauri IPC 模式接近；
- UI 可以保持 notebook 语义，不暴露终端控制序列。

缺点：

- 需要自定义完成标记协议；
- `exit`、`exec`、永久重定向 Shell 标准流等命令可终止协议；
- 无 PTY 时无法可靠支持交互输入；
- 首版若要求跨平台可靠中止，最稳妥的做法是终止并重建 Shell，会丢失运行时状态。

结论：推荐用于首版。它满足核心需求，且没有把产品扩张成终端模拟器。

### 3.2 方案 B：PTY 驱动的交互式 Bash

通过本地 PTY 启动 Bash，使用终端控制字符发送命令和 `Ctrl-C`。

优点：

- 更接近真实终端；
- 可中止前台任务并尽量保留 Shell；
- 后续可扩展 stdin、密码提示和交互程序。

缺点：

- stdout/stderr 会合并；
- 需要处理命令回显、ANSI、提示符和终端尺寸；
- notebook 输出边界更难判断；
- macOS、Linux、Windows 的信号和 PTY 行为差异较大；
- 项目虽已有远程 SSH 终端 UI，但没有本地 PTY 后端可直接复用。

结论：不建议首版采用。只有明确需要交互输入或“中止但绝不丢状态”时再升级。

### 3.3 方案 C：每个单元格启动独立进程

复用现有 `run_sandboxed_command`，通过导出环境或重放历史单元格模拟状态。

优点：

- 实现和取消都较简单；
- 超时、stdout 和 stderr 已有基础能力。

缺点：

- 无法完整恢复未导出变量、函数、alias、shell option 和当前目录；
- 重放历史会重复文件写入、安装、删除、网络请求等副作用；
- 环境快照无法代表完整 Shell 状态；
- 与已确认的 Jupyter 执行语义冲突。

结论：排除。

## 4. 总体架构

```text
ShellNotebookTool
  -> useShellNotebook controller
     -> src/lib/shellNotebook.ts typed IPC client
        -> Tauri commands + Channel<ShellNotebookEvent>
           -> ShellNotebookManager
              -> one persistent Bash process
              -> per-run temporary script
              -> stdout/stderr frame parsers
```

职责边界：

- React 页面只维护单元格、展示状态和发起用户动作；
- TypeScript IPC 模块拥有前后端 payload 类型、桌面端检测、事件归一化和 Markdown 生成；
- Rust 会话管理器拥有进程、并发约束、输出分帧、资源清理和结构化错误；
- 文件保存对话框由前端发起，文件内容由专用 Tauri command 写入。

不复用 `run_sandboxed_command` 执行单元格。该接口服务于 AI Agent 的一次性受控执行，其进程和权限语义均与本地 Shell Notebook 不同；只参考其结构化输出与错误表达方式。

## 5. 前端数据模型

### 5.1 持久化草稿

```ts
interface ShellNotebookDraftV1 {
  version: 1;
  cells: Array<{
    id: string;
    source: string;
  }>;
  startDirectory: string;
}
```

复用 `src/data/storage.ts` 的 `getStore()`，以版本化 key 只保存源码、顺序和工作目录。桌面端写入现有 Tauri Store 文件，浏览器开发模式回退到 localStorage：

- 切换工具标签或重启应用后可恢复编辑内容；
- 不加入 Repository、数据同步注册表或云同步；
- 不保存 stdout、stderr、退出码或 Shell 环境；
- 恢复草稿后显示“未启动会话”状态，必须由用户重新执行；
- 提供“清空工作区”动作，删除本地草稿。

这与终端保存历史类似，命令源码以本机明文保存。设计不承诺对命令中硬编码的密钥提供加密保护。

### 5.2 运行时状态

```ts
type CellRunStatus =
  | "idle"
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "session-lost";

interface CellRuntime {
  runId?: string;
  executionCount?: number;
  status: CellRunStatus;
  stdout: string;
  stderr: string;
  exitCode?: number;
  durationMs?: number;
  truncated?: boolean;
  executedSourceHash?: string;
}
```

运行时状态只存在于内存。`executedSourceHash` 用于在执行后再次编辑源码时标记结果已过期，而不自动删除旧输出。

## 6. 后端会话模型

### 6.1 Manager

新增 `src-tauri/src/shell_notebook/` 模块，通过 Tauri state 管理会话。计划引入 `command-group` 的 `GroupChild` 统一 Unix 进程组与 Windows Job Object 的整树终止语义，避免维护平台专用进程代码。

> 依赖状态：`command-group` **当前不在** `src-tauri/Cargo.toml`（仓库现有的是 `wait-timeout = "0.2"`），属于净新增依赖。落地前必须：
> - 确认可用版本（设计撰写时预期 `5.x`，实际以 `cargo add` 解析结果为准，不假定 `5.0.1` 存在），并在 `Cargo.toml` 精确 pin；
> - Tauri 运行在 tokio 之上，`command-group` 默认面向 `std`，必须启用其 tokio 集成 feature（例如 `with-tokio`，以该版本实际 feature 名为准），以配合 `tokio::process`；
> - 该 crate 是跨平台“整树终止”能力的单点依赖，列入风险表按依赖风险跟踪，而非既定事实。

约束：

```text
ShellNotebookManager
  sessions: Map<session_id, ShellSession>

ShellSession
  child
  stdin
  process_scope
  active_run
  channel
  start_directory
  current_directory
  protocol_token
  temp_directory
```

约束：

- 一个前端工作区对应一个 Shell 会话；
- 一个会话同一时刻最多执行一个单元格；
- 运行中再次执行返回 `session_busy`，不隐式并发；
- Bash 及其后代必须处于可统一终止的进程范围内：Unix 使用独立进程组，Windows 使用 Job Object 或等价的进程树清理机制；
- 页面卸载、应用退出、显式重启时清理整棵进程树和临时文件；
- 切换工作目录必须重启会话，因为它属于进程级配置。

### 6.2 IPC 命令

建议命令面：

```text
shell_notebook_open(config, on_event) -> SessionInfo
shell_notebook_execute(session_id, run_id, source) -> ()
shell_notebook_stop(session_id) -> StopResult
shell_notebook_restart(session_id, config) -> SessionInfo
shell_notebook_close(session_id) -> ()
shell_notebook_export_markdown(path, contents) -> ()
```

`on_event` 使用项目已在 SSH 会话中采用的 Tauri `Channel<T>`，避免动态全局事件名和 listener 泄漏。

### 6.3 事件契约

```ts
type ShellNotebookEvent =
  | { type: "ready"; sessionId: string; currentDirectory: string }
  | { type: "runStarted"; runId: string; startedAt: number }
  | { type: "output"; runId: string; stream: "stdout" | "stderr"; chunk: string }
  | {
      type: "runFinished";
      runId: string;
      exitCode: number;
      durationMs: number;
      truncated: boolean;
      currentDirectory: string;
    }
  | { type: "runCancelled"; runId: string; stateReset: boolean }
  | { type: "sessionTerminated"; runId?: string; reason: string }
  | { type: "error"; code: string; message: string; runId?: string };
```

所有失败必须使用可序列化的 `{ code, message }` 结构，前端按 code 翻译用户文案，并保留 message 作为诊断信息。不得让 Rust panic、不可解析字符串或 HTML 错误页成为用户可见结果。

## 7. 单元格执行协议

### 7.1 启动

- 解析可用的 `bash`；
- 使用现有 `proc_env::augmented_path()` 补齐 GUI 应用缺失的 PATH；
- 启动无提示符、无用户 rc 副作用的非交互式 Bash（`--norc --noprofile`）；
- 默认启用非交互式脚本所需的 alias expansion（`shopt -s expand_aliases`）；
- 使用配置的工作目录和当前桌面用户权限启动一次，之后保持进程；
- 不调用 `sandbox-exec`，不接入 Agent 的沙箱模式或审批流程。

**清洁 Shell vs. 用户 rc（已决策）**：首版以 `--norc --noprofile` 启动，追求可复现与可导出，因此**不会加载用户 `~/.bashrc`/`~/.bash_profile`**——用户自定义 alias、函数和环境不会自动存在。这与“像我平时的终端一样”存在差异，属于有意取舍。UI 空状态需明确提示“会话为干净 Bash，不加载个人 rc”，用户如需自定义可在单元格内显式 `source`。此决策登记到 §17。

首版固定 Bash 语法。macOS/Linux 直接使用 PATH 中的 Bash；Windows 只有在 Git Bash 或其他 Bash 可解析时支持执行，否则返回 `bash_not_found`。不在首版自动切换到 PowerShell 或 CMD，以免同一单元格产生不同语义。

### 7.2 执行

每次运行：

1. 后端验证 session、run id、busy 状态和源码大小（超过 `1 MiB` 返回 `source_too_large`）；
2. 将源码原样写入会话临时目录中的唯一 `.sh` 文件；
3. 向长驻 Bash stdin 写入受控 wrapper；
4. wrapper 通过 Bash builtin `source` 执行该文件，因此状态留在父 Shell；
5. wrapper 捕获退出码并写入保留变量 `LTF_LAST_EXIT_CODE`；
6. wrapper 读取当前目录，并以 **base64 编码**后的字段写入完成帧（避免路径含空格、换行、Unicode 破坏帧解析）；
7. wrapper 分别向 stdout 和 stderr 写入带随机会话 token 的完成帧；
8. 后端在两条流均收到完成帧后发送含当前目录的 `runFinished`；
9. 删除本次临时脚本。

**并发读取契约（强制）**：写入 wrapper 到 Bash stdin 之前，后端必须已启动独立的 stdout 与 stderr 异步读取任务并持续排空管道。绝不能出现“同步写 stdin，同时 Bash 因满管道阻塞在写 stdout/stderr”的顺序，否则死锁。此为本模块最易踩的实现陷阱，作为硬契约固定，测试需覆盖大输出下的写入不阻塞。

完成帧按字节流解析，不依赖换行或单次 read 的 chunk 边界。随机 token 每会话生成一次，绝不插入或回显到用户可见的单元格源码，碰撞概率可忽略。

**`set -e` 与会话致命命令（已决策：真实语义 + 优雅终止）**：`set -e`/`set -o errexit` 作为真实 shell option 在父 Shell 持久化。当用户在启用 errexit 后执行失败命令（或其它使 Bash 直接退出的情况，见 §7.4）时，整个会话进程会终止——这是忠实的 Bash 语义，不做隔离。后端 watcher 检测到进程退出后发送 `sessionTerminated`，前端将会话标记为 `session-lost`，保留源码与已有输出，并提供一键“重启会话”。UI 需能区分“单元格失败（非零退出码）”与“会话失效（进程消失）”两种状态，避免误导用户以为只是命令出错。`set -e` 属于 PRD 要求持久化的 shell option，本决策与该契约一致。

wrapper 最后恢复 Shell 的 `$?`，使下一单元格开头读取 `$?` 时与 `LTF_LAST_EXIT_CODE` 一致。稳定契约仍以 `LTF_LAST_EXIT_CODE` 和 UI 中的退出码为准，因为用户命令执行任何后续语句都会自然覆盖 `$?`。

### 7.3 输出

- stdout 与 stderr 分开传输和展示；分流后**不保证两条流之间的交错顺序**（依赖 stdout/stderr 精确交错的工作流不适用），这是满足 PRD“流可区分”要求的直接代价；
- chunk 到达即更新，不等待进程结束；
- 每次运行最多保留 2 MiB 文本，达到上限后继续排空管道但停止写入前端状态；
- 非 UTF-8 字节使用有损 UTF-8 转换，Shell Notebook 不作为二进制输出工具；
- 输出截断时设置 `truncated: true` 并显示明确状态；
- 后端不设置自动执行超时，持续运行由用户显式停止；
- 不执行 ANSI 终端仿真，展示前使用现有 `stripAnsi`。

首版不保证后台作业跨单元格存活或正确归属延迟输出。单元格返回后才产生的后台输出可能被丢弃；需要观察输出的命令应以前台方式运行。

### 7.4 破坏协议的命令

以下命令可能结束或接管长驻 Shell：

- `exit`;
- `exec <program>`;
- 对 Shell 自身 stdout/stderr 的永久 `exec >...` 重定向；
- 读取会话 stdin 的命令会等待输入；首版不转发 stdin，用户需手动停止；
- 导致 Bash 因 `set -e` 或信号直接退出的脚本。

后端 watcher 检测进程退出或完成帧缺失后发送 `sessionTerminated`。UI 保留源码和已有输出，但将会话标为失效，用户可重启后继续。首版不尝试偷偷重放历史命令恢复状态。`set -e` 触发的会话退出走同一路径，参见 §7.2 的已决策处理方式。

**临时文件清理**：会话临时目录与脚本使用固定前缀 `ltf-shellnb-*`，便于识别归属。除页面卸载、应用退出、显式重启的常规清理外，`ShellNotebookManager` 初始化时对系统临时目录做一次 best-effort 扫描，清除历史崩溃遗留的 `ltf-shellnb-*`，避免硬崩溃后临时文件泄漏。

## 8. 执行顺序

- “运行单元格”使用当前 Shell 状态执行当前源码快照；
- 执行完成后增加 execution count；
- 修改、移动或删除已执行单元格不会改变已经存在的 Shell 状态；
- 修改后的单元格标记为“结果已过期”，但旧输出仍可查看；
- “全部运行”按点击时的页面顺序创建队列并串行执行；
- 队列遇到非零退出码默认停止，避免后续命令在错误前提下继续；
- 队列执行中若会话失效（如 `set -e` 触发退出、`exit`、进程消失）也立即终止队列，其后队列项保持未执行；此时前端显示会话失效而非普通命令失败；
- “重启会话”只清空 Shell 状态和 execution count，不删除源码；
- “重启并全部运行”用于获得可复现的顺序状态。

## 9. 中止语义

方案 A 不依赖 PTY。为保证跨平台可预测，首版“停止”采用：

1. 终止当前 Bash 所属的完整进程组或 Job，避免遗留子进程；
2. 当前单元格标记为 `cancelled`；
3. 自动使用相同配置启动新会话；
4. 明确标记 `stateReset: true`，此前变量、目录、函数等运行时状态失效；
5. 单元格源码和已有输出保留。

这是首版最重要的取舍：停止一定有效，但会重置状态。若产品要求“像终端 Ctrl-C 一样中断前台任务且保留 Shell”，应升级为 PTY 方案，不能用不可靠的跨平台信号模拟。

## 10. 工作目录与本地执行权限

建议顶部工具栏提供：

- 当前工作目录；
- 文件夹选择按钮；
- 会话状态；
- 运行全部、重启、导出和清空动作。

默认行为：

- Bash 继承当前桌面用户可用的本机环境，并通过 `augmented_path()` 补齐从 GUI 启动时缺失的 PATH；
- 不设置文件系统或网络访问限制；
- 不增加 Agent 审批、危险命令检测或命令白名单；
- 未选择启动目录时，后端通过系统用户目录解析得到 `$HOME`，不依赖应用进程的启动目录；
- 用户选择的是会话启动目录，并在本机草稿中保存；
- 顶部持续展示当前 Shell 目录，同时允许重新选择启动目录；
- 切换启动目录前，若会话已有 execution count，要求确认重启；
- Shell 内执行 `cd` 后，完成帧将安全编码的实际目录回传给 UI；
- `cd` 不改写配置的启动目录，手动重启或 Stop 后自动重启都会回到启动目录；
- 本地临时目录只用于存放受控的单元格脚本文件，不作为命令执行沙箱。

Shell Notebook 与用户主动在本地终端运行命令采用相同信任模型。安全边界是用户显式点击执行和清晰展示当前目录，而不是限制命令能力。

## 11. 编辑器与交互

### 11.1 编辑器

推荐 CodeMirror 6：

- React 封装：`@uiw/react-codemirror`；
- Shell 高亮：`@codemirror/legacy-modes/mode/shell` 配合 `StreamLanguage`；
- 不引入 Monaco 的 worker、语言服务和较大体积；
- 首版仅需要高亮、缩进、撤销、行号和基础括号行为，不需要补全或 LSP。

已验证不存在 `@codemirror/lang-shell` 官方包，不能按该包设计依赖。

CodeMirror 6 依赖真实布局，在 jsdom 下渲染困难。组件测试策略需前置决定：单元格逻辑测试对编辑器做轻量 mock（仅暴露受控 value/onChange 与 ref），只在必要的少量用例中真正渲染 CM；否则编辑器相关用例会显著拖慢并变脆。

### 11.2 页面结构

- 顶部是单层工具栏，不增加二级页面；
- 主体为纵向单元格列表；
- 单元格使用紧凑边框容器，包含执行序号、运行按钮、代码编辑器和单元格菜单；
- 输出位于该单元格下方，不再嵌套卡片；
- stdout 使用普通前景色，stderr 使用错误色但不把所有 stderr 等同于失败；
- 成功或失败由退出码决定；
- 输出区提供复制、清空和折叠；
- 支持拖拽排序以及向上、向下移动的键盘可达操作；
- 运行中锁定当前单元格的删除与排序，源码可在运行结束后继续编辑。

快捷键：

- `Shift+Enter`：运行当前单元格并聚焦下一格；
- `Cmd/Ctrl+Enter`：运行当前单元格并保持焦点；
- 快捷键不替代可见按钮。

### 11.3 生命周期

Shell Notebook 标签内容在 `ToolsPage` 生命周期内保持挂载，切换其他工具标签不会终止 Shell。离开 `/tools` 或关闭应用时关闭会话；再次进入时恢复源码草稿，但运行时状态从空会话开始。

## 12. Markdown 导出

导出规则：

- 按当前页面顺序遍历；
- 忽略只含空白的单元格；
- 每个单元格成为独立的 `shell` fenced code block；
- 单元格之间保留一个空行；
- 不输出 execution count、stdout、stderr、退出码、耗时或工作目录；
- 不修改单元格源码的内部缩进和换行；
- 若源码包含连续反引号，围栏长度必须大于源码中的最长连续反引号，保证 Markdown 有效；
- 默认文件名为 `shell-notebook-YYYYMMDD-HHmm.md`。

示例：

````markdown
```shell
export APP_ENV=dev
```

```shell
echo "$APP_ENV"
```
````

## 13. 错误处理

稳定错误码至少包括：

- `desktop_only`;
- `bash_not_found`;
- `invalid_working_directory`;
- `session_not_found`;
- `session_busy`;
- `source_too_large`;
- `spawn_failed`;
- `stdin_write_failed`;
- `protocol_lost`;
- `session_terminated`;
- `export_failed`.

前端状态转换由一个 reducer 统一处理，不在多个组件中直接解释原始 IPC payload。未知事件忽略并记录诊断信息，未知错误显示后端 message。

## 14. 测试策略

### 14.1 Rust

- 完成帧跨 chunk、同 chunk、多次输出时的解析；
- stdout/stderr 双完成帧后才结束；
- 变量、当前目录、函数、alias 和 shell option 跨单元格保留；
- 非零退出码和 `$?` / `LTF_LAST_EXIT_CODE`；
- 语法错误不会被误报为成功；
- 输出截断后仍持续排空管道；
- Shell 主动退出时会话清理；
- stop 后 Bash 及子进程均退出，当前 run 取消且新会话状态为空；
- 页面卸载和应用退出不会残留会话子进程；
- busy session 拒绝第二次执行；
- 临时脚本在成功、失败和会话退出后清理。

依赖 Bash 的集成测试按平台条件运行；纯协议解析与状态机测试不依赖外部 Shell。

### 14.2 TypeScript / React

- 草稿 schema 归一化和损坏数据回退；
- 单元格增删、排序和空工作区至少保留一格；
- 实际执行顺序与页面顺序解耦；
- Run All 串行、失败停止、取消清队列；
- 事件 reducer 忽略过期 run id；
- 编辑后正确标记旧输出；
- Markdown 导出忽略空格并处理反引号围栏；
- 浏览器模式不调用 Tauri；
- 工具标签顺序在新增 Shell Notebook 后兼容旧 localStorage。

### 14.3 验证命令

规划阶段预计使用：

```bash
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

桌面交互还需在 Tauri 开发模式手工验证流式输出、停止、目录切换、重启和导出。

## 15. 复杂度评估

| 模块 | 复杂度 | 主要风险 |
|---|---|---|
| Rust 长驻 Shell 与生命周期 | 高 | 死锁（stdin 写入与满管道阻塞）、进程泄漏、协议失效、取消 |
| stdout/stderr 分帧和限流 | 高 | chunk 边界、双流完成顺序、大输出 |
| `command-group` 净新增依赖 | 中 | 版本可用性、tokio feature、跨平台整树终止行为 |
| React 单元格工作区 | 中 | 执行状态、队列、编辑后结果失效 |
| CodeMirror 集成 | 中低 | 主题、动态高度、jsdom 测试 |
| 本地草稿持久化 | 低 | schema 兼容、敏感命令明文 |
| Markdown 导出 | 低 | 围栏转义、文件错误 |
| 跨平台验证 | 高 | Bash 可用性、macOS 自带 Bash 3.2、进程终止、Windows 路径/CRLF、本机环境差异 |

> macOS 系统自带 Bash 为 3.2；`augmented_path()` 补齐 PATH 后 Homebrew 的新版 Bash 不保证优先。测试与 wrapper 不得依赖 Bash 4+ 特性（关联数组、`${x,,}` 等），并需在 3.2 上验证 `shopt -s expand_aliases` 行为。Windows/Git Bash 下还需验证临时 `.sh` 路径与写入 stdin 的 wrapper 不被 MSYS 路径改写或 CRLF 转换破坏。

按一名熟悉项目的工程师估算：

- macOS/Linux MVP：约 7 到 11 个开发日；
- Windows Bash 探测与专项验证：额外约 2 到 4 个开发日；
- 若首版改为 PTY 并要求中止后保留状态：额外约 3 到 5 个开发日，并提高回归风险。

该估算包含单元测试和桌面手工验证，不包含后续的 notebook 导入、交互 stdin 或多会话管理。

## 16. 关键取舍

1. 真实状态优先于复用现有一次性命令接口。
2. Notebook 可控性优先于完整终端兼容。
3. 实际执行顺序优先于按页面位置自动重放。
4. 停止可靠性优先于首版保留运行时状态。
5. 本地恢复源码优先于跨端同步，输出不持久化。
6. Bash 语义一致性优先于自动切换平台 Shell。
7. 结构化 IPC 契约优先于组件直接解析零散字符串。

## 17. 决策状态

已确认：

- Stop 会自动重启 Shell，因此运行时状态丢失。
- Bash 直接使用当前桌面用户权限，不接入 Agent 沙箱或审批流程。
- 未选择目录时从用户主目录 `$HOME` 启动；重启会话回到配置的启动目录。
- 单元格源码、顺序和启动目录在本机自动保存；输出和 Shell 状态不保存、不参与云同步。
- Run All 遇到首个非零退出码立即停止队列。
- 首版固定 Bash；Windows 找不到 Bash 时提示不可用，不回退到其他 Shell。
- 编辑器采用轻量 CodeMirror 6，不引入 Monaco。
- 首版实时流式输出且无自动超时；不提供 stdin、PTY、密码提示或 TUI 交互。
- `set -e` 采用真实语义：作为 shell option 持久化；启用后失败命令终止整个会话，前端标记 `session-lost`、保留源码与输出并提供一键重启，UI 区分“单元格失败”与“会话失效”。
- 首版以 `--norc --noprofile` 启动干净 Bash，不加载用户 `~/.bashrc`/`~/.bash_profile`；UI 空状态明确提示。
- `source_too_large` 阈值定为 `1 MiB`。
- `command-group` 为净新增依赖，需确认实际版本并启用 tokio feature，不假定 `5.0.1`。
