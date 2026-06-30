// @ts-expect-error - dagre doesn't have types
import dagre from 'dagre';
import { SeaNode, SeaEdge } from '../types/json-diagram';

/**
 * 节点尺寸配置（单位：像素）
 */
const NODE_SIZES = {
  MIN_WIDTH: 150,
  MAX_WIDTH: 240,
  ROW_HEIGHT: 40,
  PADDING: 12,
};

/**
 * 计算节点高度
 * 基于节点内容（字符长度）
 */
function calculateNodeHeight(node: SeaNode): number {
  const baseHeight = NODE_SIZES.ROW_HEIGHT;
  const data = node.data;

  if (data.childrenCount !== undefined) {
    // 容器节点：基础高度 + 子元素数量
    return baseHeight + Math.min(data.childrenCount, 10) * (NODE_SIZES.ROW_HEIGHT / 2);
  }

  // 基本值节点
  const valueStr = String(data.value || '');
  const lines = Math.max(1, Math.ceil(valueStr.length / 20)); // 每行约 20 字符
  return baseHeight + (lines - 1) * NODE_SIZES.ROW_HEIGHT;
}

/**
 * 计算节点宽度
 */
function calculateNodeWidth(node: SeaNode): number {
  const data = node.data;
  let width = NODE_SIZES.MIN_WIDTH;

  if (data.childrenCount !== undefined) {
    // 根据子元素数量调整宽度
    const childCount = Math.max(data.childrenCount, 1);
    width = Math.min(
      NODE_SIZES.MAX_WIDTH,
      NODE_SIZES.MIN_WIDTH + Math.log(childCount) * 30
    );
  } else {
    // 基本值节点：根据值长度调整
    const valueStr = String(data.value || '');
    width = Math.min(
      NODE_SIZES.MAX_WIDTH,
      NODE_SIZES.MIN_WIDTH + valueStr.length * 6
    );
  }

  return width;
}

/**
 * 使用 Dagre 进行自动布局
 * 将所有节点重新排列到合适的位置
 */
export function layoutNodesWithDagre(
  nodes: SeaNode[],
  edges: SeaEdge[]
): SeaNode[] {
  // 创建 Dagre 图
  const graph = new dagre.graphlib.Graph();

  // 配置图的方向为从左到右 (LR)
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: 'LR', // Left to Right
    align: 'UL',
    nodesep: 50,
    ranksep: 100,
  });

  // 添加所有节点到图中
  nodes.forEach((node) => {
    const width = calculateNodeWidth(node);
    const height = calculateNodeHeight(node);
    graph.setNode(node.id, {
      width,
      height,
    });
  });

  // 添加边（只考虑默认类型的边）
  edges
    .filter((edge) => edge.type === 'default')
    .forEach((edge) => {
      graph.setEdge(edge.source, edge.target);
    });

  // 执行 Dagre 布局算法
  dagre.layout(graph);

  // 提取新的坐标并更新节点
  return nodes.map((node) => {
    const layoutNode = graph.node(node.id);
    const fallbackX = node.data.depth * 260;
    const fallbackY = nodes.findIndex((candidate) => candidate.id === node.id) * 120;

    if (
      layoutNode &&
      Number.isFinite(layoutNode.x) &&
      Number.isFinite(layoutNode.y)
    ) {
      const width = calculateNodeWidth(node);
      const height = calculateNodeHeight(node);

      return {
        ...node,
        position: {
          x: layoutNode.x - width / 2,
          y: layoutNode.y - height / 2,
        },
      };
    }

    return {
      ...node,
      position: {
        x: fallbackX,
        y: fallbackY,
      },
    };
  });
}

/**
 * 手动布局（如果 Dagre 不可用）
 * 按照深度分层布置
 */
export function layoutNodesManually(nodes: SeaNode[]): SeaNode[] {
  const depthMap = new Map<number, SeaNode[]>();

  // 按深度分组
  nodes.forEach((node) => {
    const depth = node.data.depth || 0;
    if (!depthMap.has(depth)) {
      depthMap.set(depth, []);
    }
    depthMap.get(depth)!.push(node);
  });

  // 分层布置
  return nodes.map((node) => {
    const depth = node.data.depth || 0;
    const nodesAtDepth = depthMap.get(depth) || [];
    const indexInDepth = nodesAtDepth.indexOf(node);

    return {
      ...node,
      position: {
        x: depth * 300, // 横向：按深度均匀分布
        y: indexInDepth * 150, // 纵向：同级节点垂直排列
      },
    };
  });
}
