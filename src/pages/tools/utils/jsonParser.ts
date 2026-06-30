import { SeaNode, SeaEdge, JsonDiagramTree, JsonDataType, NodeType } from '../types/json-diagram';

/**
 * 检测值的数据类型
 */
function getJsonDataType(value: unknown): JsonDataType {
  if (value === null) return JsonDataType.Null;
  if (typeof value === 'string') return JsonDataType.String;
  if (typeof value === 'number') return JsonDataType.Number;
  if (typeof value === 'boolean') return JsonDataType.Boolean;
  return JsonDataType.Object;
}

/**
 * 构建 JSON Path 字符串
 */
function buildJsonPath(parentPath: string, key: string | number): string {
  if (parentPath === '$') {
    if (typeof key === 'number') {
      return `$[${key}]`;
    }
    return `$.${key}`;
  }
  if (typeof key === 'number') {
    return `${parentPath}[${key}]`;
  }
  return `${parentPath}.${key}`;
}

/**
 * 检查对象是否是容器类型（对象或数组）
 */
function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === 'object';
}

/**
 * 计算容器中的元素个数
 */
function getContainerSize(value: Record<string, unknown> | unknown[]): number {
  return Array.isArray(value) ? value.length : Object.keys(value).length;
}

/**
 * JSON 解析器：将 JSON 转换为 Sea Nodes 和 Edges
 */
export function parseJsonToNodes(
  json: unknown,
  maxDepth: number = 3
): JsonDiagramTree {
  const nodes: SeaNode[] = [];
  const edges: SeaEdge[] = [];
  const nodeMap = new Map<string, SeaNode>();
  const visitedObjects = new WeakSet<object>();

  let nodeIdCounter = 0;
  const generateNodeId = (): string => `node-${nodeIdCounter++}`;

  /**
   * 递归遍历 JSON，生成节点和边
   */
  function traverse(
    value: unknown,
    depth: number,
    path: string,
    parentNodeId?: string
  ): string | null {
    // 超过最大深度限制
    if (depth > maxDepth) {
      return null;
    }

    // 处理循环引用
    if (isContainer(value) && visitedObjects.has(value as object)) {
      return null;
    }

    if (isContainer(value)) {
      visitedObjects.add(value as object);
    }

    const nodeId = generateNodeId();
    const isArray = Array.isArray(value);
    const dataType = isArray ? JsonDataType.Array : getJsonDataType(value);

    if (isContainer(value)) {
      // 容器节点（对象或数组）
      const nodeType = isArray ? NodeType.Array : NodeType.Object;
      const containerSize = getContainerSize(value as Record<string, unknown> | unknown[]);
      const isLimited = depth >= maxDepth;

      const node: SeaNode = {
        id: nodeId,
        type: nodeType,
        data: {
          depth,
          path,
          dataType,
          value: isArray ? (value as unknown[]).length : Object.keys(value as Record<string, unknown>).length,
          parentNodeId,
          childrenCount: containerSize,
          isLimited,
          ...(isArray ? { arrayIndex: undefined } : {}),
        },
        position: { x: depth * 200, y: 0 },
      };

      nodes.push(node);
      nodeMap.set(nodeId, node);

      if (parentNodeId) {
        edges.push({
          id: `edge-${parentNodeId}-${nodeId}`,
          source: parentNodeId,
          target: nodeId,
          type: 'default',
        });
      }

      // 遍历子元素
      if (!isLimited) {
        if (isArray) {
          (value as unknown[]).forEach((item, index) => {
            const childPath = buildJsonPath(path, index);
            const childNodeId = traverse(item, depth + 1, childPath, nodeId);
            if (childNodeId && typeof item !== 'object') {
              // 已创建边在 traverse 中
            }
          });
        } else {
          Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
            const childPath = buildJsonPath(path, key);
            const childNodeId = traverse(item, depth + 1, childPath, nodeId);
            if (childNodeId && typeof item !== 'object') {
              // 已创建边在 traverse 中
            }
          });
        }
      }

      return nodeId;
    } else {
      // 基本值节点
      const node: SeaNode = {
        id: nodeId,
        type: NodeType.Primitive,
        data: {
          depth,
          path,
          dataType,
          value,
          parentNodeId,
          objectKey: typeof path === 'string' ? path.split('.').pop() : undefined,
        },
        position: { x: depth * 200, y: 0 },
      };

      nodes.push(node);
      nodeMap.set(nodeId, node);

      if (parentNodeId) {
        edges.push({
          id: `edge-${parentNodeId}-${nodeId}`,
          source: parentNodeId,
          target: nodeId,
          type: 'default',
        });
      }

      return nodeId;
    }
  }

  // 开始遍历
  if (isContainer(json)) {
    traverse(json, 0, '$');
  } else {
    // 单个基本值
    const nodeId = generateNodeId();
    const dataType = getJsonDataType(json);
    const node: SeaNode = {
      id: nodeId,
      type: NodeType.Primitive,
      data: {
        depth: 0,
        path: '$',
        dataType,
        value: json,
      },
      position: { x: 0, y: 0 },
    };
    nodes.push(node);
    nodeMap.set(nodeId, node);
  }

  return { nodes, edges, nodeMap };
}
