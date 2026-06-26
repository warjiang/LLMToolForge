# LLMToolForge

为大模型提供各类工具的统一管理桌面端：**API Key 管理、Skill 管理、MCP 管理**。

## 技术栈

- **桌面框架**：Tauri 2（Rust + WebView）
- **前端**：React 18 + TypeScript + Vite
- **UI**：shadcn 风格组件 + Tailwind CSS，设计对齐 Vercel [Geist](https://vercel.com/geist) 设计系统（明 / 暗主题）
- **路由 / 状态**：react-router-dom + zustand
- **本地持久化**：tauri-plugin-store（浏览器开发时自动回退到 localStorage），通过 repository 抽象层封装

## 功能

- **概览（Dashboard）**：各模块统计与快速入口
- **API Keys**：提供商密钥的增删改查，列表掩码展示、一键复制
- **Providers（多 provider 接入）**：统一入口，顶部切换 provider 类型，新增接入时手动选择 provider
  - **Volcengine（火山引擎）**：录入 AK/SK，自动拉取账号已开通的模型（推理 Endpoint）与 Ark API Key；模型按 context window / Function Call / 多模态等能力分类展示
  - **New API**：OpenAI 兼容网关，录入 Base URL + API Key，通过 `/v1/models` 拉取可用模型
  - **LiteLLM**：OpenAI 兼容代理，录入 Base URL + API Key，通过 `/v1/models` 拉取可用模型
- **Playground**：基于已接入的连接（Volcengine 凭证或 New API / LiteLLM 网关）的对话测试台，支持 OpenAI Chat 与 Responses（火山引擎）两种请求格式、流式输出、System Prompt / 温度 / Max Tokens 参数，多模态模型可附带图片输入
- **Unified API（本地统一网关）**：把已接入的各 provider 模型统一暴露为一个本地 HTTP 服务，供 Codex、Claude Code 与本地 agent 直接使用（仅桌面端 Tauri 运行时可启动服务）
  - **OpenAI 兼容**：`GET /v1/models`、`POST /v1/chat/completions`（流式 + 非流式）
  - **Anthropic 兼容**：`POST /v1/messages`（请求/响应/流式事件与工具调用翻译，供 Claude Code 使用）
  - 模型 id 形如 `{连接名}/{model}`，默认全部暴露，可按模型单独开关；可选本地 API Key 校验
  - 内置交互式文档：`GET /openapi.json`（OpenAPI 3.1）、`GET /docs`（Redoc）
  - 内置接入指南：OpenAI Python / Node SDK、curl、Codex、Claude Code 一键复制示例
  - 调用监控：实时调用日志、成功率 / P95 耗时 / token 统计与 SVG 图表，支持过滤、清空、导出（JSON/CSV）
- **Skills**：技能的增删改查、启用开关、标签
- **Agent（基于 Pi 的智能体）**：基于 [`earendil-works/pi`](https://github.com/earendil-works/pi)（`@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`）的真实 agent，支持多轮 tool loop、流式输出与工具的真正执行（仅桌面端可用）
  - **模型接入**：经本地 Unified 网关路由（`http://127.0.0.1:<port>/v1`），使用 pi-ai 原生 `openai-completions` provider；运行前需先在 Unified 页面启动网关并启用模型
  - **内部工具**：`bash` 与文件工具 `read / write / edit / ls / grep`（Rust 实现），按沙箱模式（read-only / workspace-write / danger-full-access）门控，限定在工作目录内
  - **外部工具（MCP）**：把每个启用的 MCP Server 的 Tools 包装为 agent 工具，经现有 `mcp_inspect` / `mcp_call_tool` 真正执行
  - **Skill 调用**：Pi 风格——启用的 Skill 以 `<available_skills>` 注入系统提示词，并提供 `load_skill` 工具按需加载内容
  - **自定义 Agent**：可创建可复用的 `AgentDefinition`（系统提示词 / 模型 / 内部工具 / Skill / MCP / 沙箱 / 温度 / Max Tokens），在输入栏下拉选择，内置最小管理页（增删改查）
- **MCP Servers**：MCP 服务器增删改查，按传输方式（stdio / SSE / HTTP）动态表单、启用开关；支持从标准 `mcpServers` JSON 一键导入（重名自动跳过并提示）；内置 **Inspector**：连接服务器完成 `initialize` 握手，浏览并调用其 Tools（按 JSON Schema 生成参数表单 / 原始 JSON 两种模式）、读取 Resources、获取 Prompts，结果实时展示（仅桌面端可用）
- **实用工具**：URL 编解码、JSON 预览（尽力解开被转义/双重编码的嵌套字段）、转义/去转义、Unicode 编解码，纯本地计算
- **设置**：主题切换、数据存储说明

> 第一阶段为脚手架 + UI 骨架 + 本地 CRUD，数据保存在本机；加密存储与云端同步将在后续版本提供。

## 开发

前置：Node.js + pnpm，以及 Rust 工具链（用于 Tauri）。

```bash
pnpm install

# 仅前端（浏览器，数据走 localStorage）
pnpm dev

# 桌面应用（Tauri，数据走 tauri-plugin-store）
pnpm tauri:dev
```

## 构建

```bash
# 前端产物
pnpm build

# 桌面安装包
pnpm tauri:build
```

## 目录结构

```
src/
  components/
    ui/          # 基础组件（button、input、dialog…）
    layout/      # 侧边栏、顶栏、应用外壳
    common/      # PageHeader、EmptyState、ConfirmDialog、ModelFeatureBadges
  data/          # 存储适配层 + repository 抽象
  store/         # zustand 状态（集合 store 工厂、主题）
  pages/         # 各功能页面与表单弹窗（含 providers/、playground/）
  lib/
    http.ts      # Tauri/浏览器统一的 fetch（桌面端绕过 CORS）
    volc/        # 火山引擎 OpenAPI V4 签名
    providers/   # provider 适配层（统一类型 + volcengine 管理/推理 + openai-compatible 网关）
  types/         # 数据模型
src-tauri/       # Tauri Rust 后端
```

## CI / CD

通过 GitHub Actions 实现持续集成与跨平台发布。

### CI（`.github/workflows/ci.yml`）

每次向 `main` 推送或提 PR 时运行：

- **Frontend**：`pnpm install` → `pnpm build`（`tsc` 类型检查 + Vite 构建）
- **Rust**：在 Linux / Windows / macOS 上执行 `cargo fmt --check`、`cargo clippy -D warnings`、`cargo check`

### Release（`.github/workflows/release.yml`）

推送 `v*` 形式的 tag（或手动 `workflow_dispatch`）时，使用
[`tauri-action`](https://github.com/tauri-apps/tauri-action) 在矩阵中构建并发布到 GitHub Release（草稿）：

| 平台 | Runner | 产物 |
| --- | --- | --- |
| macOS Apple Silicon | `macos-latest` (`aarch64-apple-darwin`) | `.dmg` / `.app` |
| macOS Intel | `macos-latest` (`x86_64-apple-darwin`) | `.dmg` / `.app` |
| Linux x64 | `ubuntu-22.04` | `.AppImage` / `.deb` / `.rpm` |
| Windows x64 | `windows-latest` | `.msi` / `.exe (NSIS)` |

发布步骤：

```bash
# 1. 更新版本号（package.json / src-tauri/Cargo.toml / src-tauri/tauri.conf.json）
# 2. 打 tag 并推送
git tag v0.1.0
git push origin v0.1.0
# 3. Actions 自动构建各平台产物并创建 Release 草稿，确认后手动发布
```

### 可选签名 / 自动更新

以下能力通过仓库 Secrets 开启（未配置时自动跳过）：

- **macOS 签名/公证**：`APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`
- **Tauri Updater 签名**：`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
