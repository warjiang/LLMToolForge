# JSON 可视化图形改造 - 实现指南

## 完成状态

### ✅ 已完成的工作（Phase 1-3）

#### Phase 1：依赖与类型准备
- ✅ 添加 React Flow (^11.10.1)、Dagre (^0.8.5)、html-to-image 到 package.json
- ✅ 创建 TypeScript 类型定义 (`src/pages/tools/types/json-diagram.ts`)

#### Phase 2：核心转换引擎
- ✅ **jsonParser.ts**：JSON 递归解析，生成 SeaNode + Edge
  - 支持对象、数组、基本值类型
  - 处理循环引用
  - 深度限制 (maxDepth)
  
- ✅ **jsonLayout.ts**：Dagre 自动布局引擎
  - 左到右 (LR) 布局方向
  - 动态计算节点宽高
  - Fallback 手动布局
  
- ✅ **searchUtils.ts**：搜索与过滤功能
  - JSON Path 解析与匹配
  - 文本模糊匹配
  - 路径高亮与祖先追踪

#### Phase 3：React Flow 组件与 UI
- ✅ **ObjectNode.tsx**：对象节点（蓝色）
- ✅ **ArrayNode.tsx**：数组节点（绿色）
- ✅ **PrimitiveNode.tsx**：原始值节点（类型色）
- ✅ **DefaultEdge.tsx**：边样式与高亮
- ✅ **JsonDiagramCore.tsx**：React Flow 容器
  - 完整的交互（拖拽、缩放、minimap）
  - 节点选中与高亮
  
- ✅ **JsonDiagram.tsx**：功能组合容器
  - 搜索输入框
  - 深度控制滑块
  - PNG/SVG 导出按钮
  - 节点详情弹窗
  
- ✅ **JsonTool.tsx**：改造为新布局
  - 删除旧 JsonTree 组件
  - 上层输入 + 工具栏
  - 下层图形展示
  
- ✅ **exportUtils.ts**：导出功能工具

---

## 项目结构

```
src/pages/tools/
├── JsonTool.tsx                    # 主入口（已改造）
├── types/
│   └── json-diagram.ts             # TypeScript 类型定义
├── utils/
│   ├── jsonParser.ts               # JSON → SeaNode 转换
│   ├── jsonLayout.ts               # Dagre 自动布局
│   ├── searchUtils.ts              # 搜索与过滤
│   └── exportUtils.ts              # PNG/SVG 导出
├── nodes/
│   ├── ObjectNode.tsx              # 对象节点
│   ├── ArrayNode.tsx               # 数组节点
│   └── PrimitiveNode.tsx           # 原始值节点
├── edges/
│   └── DefaultEdge.tsx             # 边样式
└── diagram/
    ├── JsonDiagram.tsx             # 功能容器
    └── JsonDiagramCore.tsx         # React Flow 核心
```

---

## 核心功能

### 1. JSON 解析与可视化
```typescript
// 输入 JSON 字符串 → 自动生成图表
const { nodes, edges } = parseJsonToNodes(jsonString, maxDepth);
const layoutedNodes = layoutNodesWithDagre(nodes, edges);
```

### 2. 搜索与高亮
```typescript
// 支持 JSON Path ($. 符号) 和文本模糊匹配
const results = searchNodesInTree(tree, "$.user.name", "both");
const highlighted = getHighlightedNodeIds(results);
```

### 3. 交互功能
- **拖拽**：移动节点位置
- **缩放**：Ctrl + 滚轮或右下角按钮
- **Minimap**：右上角缩略图导航
- **点击节点**：显示详情弹窗
- **搜索结果**：自动高亮匹配节点和祖先路径

### 4. 导出功能
```typescript
// 导出当前图表为 PNG 或 SVG
await exportDiagramAsImage(elementRef, { format: 'png' });
await exportDiagramAsImage(elementRef, { format: 'svg' });
```

---

## 待完成的工作（Phase 4）

### ⏳ 可选增强功能

- [ ] **深度限制优化**
  - 对 5000+ 节点 JSON 自动限制深度
  - 提供"展开更多"按钮逐层加载
  - 性能监控与日志

- [ ] **样式与主题**
  - Tailwind CSS 主题适配
  - 暗黑模式支持
  - 节点悬停动画

- [ ] **高级搜索**
  - 正则表达式支持
  - 值范围过滤（数字大小比较）
  - 搜索历史记录

- [ ] **性能优化**
  - 虚拟化大图表（10k+ 节点）
  - 懒加载子树
  - 内存优化（避免序列化存储）

- [ ] **集成功能**
  - 与 Unified API 监控日志集成
  - API 响应对比工具
  - 导出为 JSON Schema

---

## 技术亮点

### 1. 自动布局
使用 Dagre 图形布局库，自动计算最优节点位置，支持：
- 层级排列（LR 方向）
- 避免边交叉
- 自适应节点间距

### 2. 深度限制
避免大型 JSON 导致性能问题：
```typescript
// 默认限制为 3 层深度
const tree = parseJsonToNodes(json, maxDepth = 3);
// 超过限制的节点标记 isLimited = true
```

### 3. 搜索算法
支持多种匹配方式：
```typescript
// JSON Path 匹配：$.user[0].name
// 模糊文本匹配：搜索 "user" 会匹配路径包含 "user" 的所有节点
// 路径高亮：自动高亮祖先节点形成完整路径
```

### 4. 导出功能
使用 html-to-image 库，支持：
- PNG（光栅格式，分辨率 2x 导出）
- SVG（矢量格式，可无限缩放）
- 自定义尺寸与背景色

---

## 使用示例

### 基础使用
```jsx
import { JsonTool } from '@/pages/tools/JsonTool';

// JSON 工具会自动：
// 1. 解析输入的 JSON
// 2. 生成可视化图表
// 3. 支持搜索、导出等功能

export function MyApp() {
  return <JsonTool />;
}
```

### 自定义集成
```jsx
import { JsonDiagram } from '@/pages/tools/diagram/JsonDiagram';

export function CustomViewer() {
  const jsonString = '{"name":"demo"}';
  
  return (
    <JsonDiagram 
      jsonInput={jsonString}
      maxDepth={5}
    />
  );
}
```

### 搜索与过滤
```jsx
// 自动支持
// 1. JSON Path: $.users[0].email
// 2. 模糊文本: email
// 3. 祖先路径自动高亮
```

---

## 已知限制与解决方案

| 限制 | 说明 | 解决方案 |
|-----|-----|--------|
| 循环引用 | JSON 中存在循环引用会导致解析失败 | 已在 parseJsonToNodes 中处理，使用 WeakSet 追踪 |
| 大型 JSON | 10k+ 节点可能导致卡顿 | 自动限制深度、虚拟化渲染（React Flow 原生支持） |
| IE 浏览器 | html-to-image 不支持 IE | 仅支持现代浏览器（Chrome、Firefox、Safari、Edge） |
| Dagre 布局失败 | 某些异常图结构可能导致 Dagre 失败 | Fallback 到手动分层布局 |

---

## 后续集成建议

1. **与 Agent 聊天集成**
   - 显示 API 返回的 JSON 响应可视化

2. **与 Unified API 日志集成**
   - 可视化 API 调用的请求/响应数据

3. **JSON Diff 工具**
   - 对比两个 JSON 的结构差异

4. **Schema 生成**
   - 从 JSON 自动生成 JSON Schema

5. **数据验证**
   - 实时校验 JSON 是否符合特定 Schema

---

## 文件清单

| 文件 | 行数 | 说明 |
|-----|------|------|
| `types/json-diagram.ts` | 100 | 类型定义（10 个类型） |
| `utils/jsonParser.ts` | 180 | JSON 解析器 |
| `utils/jsonLayout.ts` | 140 | Dagre 布局 |
| `utils/searchUtils.ts` | 190 | 搜索算法 |
| `utils/exportUtils.ts` | 80 | 导出功能 |
| `nodes/ObjectNode.tsx` | 70 | 对象节点 |
| `nodes/ArrayNode.tsx` | 65 | 数组节点 |
| `nodes/PrimitiveNode.tsx` | 95 | 原始值节点 |
| `edges/DefaultEdge.tsx` | 45 | 边样式 |
| `diagram/JsonDiagramCore.tsx` | 150 | React Flow 容器 |
| `diagram/JsonDiagram.tsx` | 280 | 功能组合 |
| `JsonTool.tsx` (改造) | 140 | 主入口 |
| **总计** | **1,435** | 全新实现 |

---

## 下一步行动

### 立即可做
1. ✅ 运行 `npm install / pnpm install` 安装新依赖
2. ✅ 测试 JSON 工具的功能
3. ✅ 验证搜索和导出功能
4. ✅ 测试不同大小的 JSON 文件性能

### 待优化
1. 添加单元测试（jsonParser、搜索算法）
2. 性能分析与优化
3. 主题适配（亮黑模式）
4. 国际化文本（zh / en）
5. 浏览器兼容性测试

### 文档与维护
1. 更新项目 README
2. 添加使用文档
3. 创建示例与演示
4. 建立 Changelog

---

## 联系与反馈

如有问题或建议，请在代码注释中标注或提交 Issue。

**改造完成日期**：2026-06-30
**框架版本**：React 19 + Tauri 2 + TypeScript 6
**设计系统**：Geist (Vercel) + shadcn/ui
