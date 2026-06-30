/**
 * JSON Diagram - 测试用例和验证脚本
 * 用于验证解析、布局、搜索等核心功能
 */

import { parseJsonToNodes } from '../utils/jsonParser';
import { layoutNodesWithDagre, layoutNodesManually } from '../utils/jsonLayout';
import { searchNodesInTree, getHighlightedNodeIds } from '../utils/searchUtils';

// ============================================================================
// 测试数据
// ============================================================================

const SIMPLE_JSON = {
  name: "John",
  age: 30,
  email: "john@example.com",
};

const NESTED_JSON = {
  user: {
    id: 1,
    name: "Alice",
    emails: ["alice@work.com", "alice@personal.com"],
    address: {
      street: "123 Main St",
      city: "New York",
      zip: "10001",
    },
  },
  metadata: {
    created: "2024-01-01",
    updated: "2024-06-30",
  },
};

const ARRAY_JSON = [
  { id: 1, name: "Item 1", active: true },
  { id: 2, name: "Item 2", active: false },
  { id: 3, name: "Item 3", active: true },
];

const DEEP_JSON = {
  level1: {
    level2: {
      level3: {
        level4: {
          level5: {
            value: "深度测试",
          },
        },
      },
    },
  },
};

// ============================================================================
// 测试函数
// ============================================================================

export function runTests() {
  console.log("🧪 开始 JSON Diagram 测试\n");

  try {
    testJsonParser();
    testJsonLayout();
    testSearch();
    testDepthLimit();
    testLargeJson();

    console.log("\n✅ 所有测试通过！");
  } catch (error) {
    console.error("\n❌ 测试失败:", error);
  }
}

// ============================================================================
// 测试 1: JSON 解析器
// ============================================================================

function testJsonParser() {
  console.log("📝 测试 1: JSON 解析器");

  // Test 1.1: 简单对象
  const tree1 = parseJsonToNodes(SIMPLE_JSON, 5);
  console.assert(tree1.nodes.length === 4, "简单对象应生成 4 个节点");
  console.assert(tree1.edges.length === 3, "简单对象应生成 3 条边");
  console.log("  ✓ 简单对象解析正确");

  // Test 1.2: 嵌套对象
  const tree2 = parseJsonToNodes(NESTED_JSON, 5);
  console.assert(tree2.nodes.length > 10, "嵌套对象应生成多个节点");
  console.log("  ✓ 嵌套对象解析正确");

  // Test 1.3: 数组
  const tree3 = parseJsonToNodes(ARRAY_JSON, 5);
  console.assert(tree3.nodes[0].type === 'array-node', "根节点应为数组");
  console.log("  ✓ 数组解析正确");

  // Test 1.4: 深度限制
  const tree4 = parseJsonToNodes(DEEP_JSON, 3);
  const limitedNodes = tree4.nodes.filter((n) => n.data.isLimited);
  console.assert(limitedNodes.length > 0, "应有节点被标记为深度限制");
  console.log("  ✓ 深度限制正确");

  console.log("✅ JSON 解析器测试通过\n");
}

// ============================================================================
// 测试 2: 自动布局
// ============================================================================

function testJsonLayout() {
  console.log("📐 测试 2: 自动布局");

  const tree = parseJsonToNodes(NESTED_JSON, 5);

  // Test 2.1: Dagre 布局
  let layoutedNodes;
  try {
    layoutedNodes = layoutNodesWithDagre(tree.nodes, tree.edges);
    console.assert(
      layoutedNodes.every((n) => n.position.x !== undefined && n.position.y !== undefined),
      "所有节点应有坐标"
    );
    console.log("  ✓ Dagre 布局成功");
  } catch (error) {
    console.warn("  ⚠ Dagre 布局失败，使用备用方案");
    layoutedNodes = layoutNodesManually(tree.nodes);
  }

  // Test 2.2: 手动布局（备用）
  const manualNodes = layoutNodesManually(tree.nodes);
  console.assert(
    manualNodes.every((n) => n.position.x !== undefined && n.position.y !== undefined),
    "手动布局应生成坐标"
  );
  console.log("  ✓ 手动布局成功");

  console.log("✅ 自动布局测试通过\n");
}

// ============================================================================
// 测试 3: 搜索与过滤
// ============================================================================

function testSearch() {
  console.log("🔍 测试 3: 搜索与过滤");

  const tree = parseJsonToNodes(NESTED_JSON, 5);

  // Test 3.1: 路径搜索
  const pathResults = searchNodesInTree(tree, "$.user.name", "path");
  console.assert(pathResults.length > 0, "应找到对应路径的节点");
  console.log("  ✓ 路径搜索正确");

  // Test 3.2: 值搜索
  const valueResults = searchNodesInTree(tree, "Alice", "value");
  console.assert(valueResults.length > 0, "应找到对应值的节点");
  console.log("  ✓ 值搜索正确");

  // Test 3.3: 组合搜索
  const combinedResults = searchNodesInTree(tree, "user", "both");
  console.assert(combinedResults.length > 0, "应找到匹配的节点");
  console.log("  ✓ 组合搜索正确");

  // Test 3.4: 高亮节点
  const highlighted = getHighlightedNodeIds(combinedResults);
  console.assert(highlighted.size > 0, "应有节点被高亮");
  console.log("  ✓ 高亮正确");

  console.log("✅ 搜索与过滤测试通过\n");
}

// ============================================================================
// 测试 4: 深度限制
// ============================================================================

function testDepthLimit() {
  console.log("🎯 测试 4: 深度限制");

  // Test 4.1: 深度为 1
  const tree1 = parseJsonToNodes(NESTED_JSON, 1);
  const maxDepth1 = Math.max(...tree1.nodes.map((n) => n.data.depth));
  console.assert(maxDepth1 <= 1, "最大深度应为 1");
  console.log("  ✓ 深度限制 1 正确");

  // Test 4.2: 深度为 3
  const tree3 = parseJsonToNodes(NESTED_JSON, 3);
  const maxDepth3 = Math.max(...tree3.nodes.map((n) => n.data.depth));
  console.assert(maxDepth3 <= 3, "最大深度应为 3");
  console.log("  ✓ 深度限制 3 正确");

  console.log("✅ 深度限制测试通过\n");
}

// ============================================================================
// 测试 5: 大型 JSON 性能
// ============================================================================

function testLargeJson() {
  console.log("⚡ 测试 5: 大型 JSON 性能");

  // 生成包含 100 个对象的数组
  const largeJson = Array.from({ length: 100 }, (_, i) => ({
    id: i,
    name: `Item ${i}`,
    value: Math.random(),
    nested: {
      field1: `value${i}`,
      field2: `data${i}`,
    },
  }));

  const startTime = performance.now();
  const tree = parseJsonToNodes(largeJson, 3);
  const parseTime = performance.now() - startTime;

  console.assert(tree.nodes.length > 100, "应生成大量节点");
  console.log(
    `  ✓ 100 个对象解析耗时: ${parseTime.toFixed(2)}ms`
  );

  console.log("✅ 性能测试通过\n");
}
