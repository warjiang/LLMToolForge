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
- **Skills**：技能的增删改查、启用开关、标签
- **MCP Servers**：MCP 服务器增删改查，按传输方式（stdio / SSE / HTTP）动态表单、启用开关
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
    common/      # PageHeader、EmptyState、ConfirmDialog
  data/          # 存储适配层 + repository 抽象
  store/         # zustand 状态（集合 store 工厂、主题）
  pages/         # 各功能页面与表单弹窗
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
