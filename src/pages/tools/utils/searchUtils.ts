import { SeaNode, SearchResult, JsonDiagramTree } from '../types/json-diagram';

/**
 * 解析 JSON Path（如 $.user.name 或 $.items[0]）
 */
function parseJsonPath(pathStr: string): (string | number)[] {
  if (pathStr === '$') return [];

  const parts: (string | number)[] = [];
  let current = '';
  let inBracket = false;

  for (let i = 1; i < pathStr.length; i++) {
    const char = pathStr[i];

    if (char === '[') {
      if (current) {
        if (current.startsWith('.')) {
          parts.push(current.substring(1));
        } else {
          parts.push(current);
        }
        current = '';
      }
      inBracket = true;
    } else if (char === ']') {
      if (inBracket && current) {
        const num = parseInt(current, 10);
        if (!isNaN(num)) {
          parts.push(num);
        }
      }
      current = '';
      inBracket = false;
    } else if (char === '.' && !inBracket) {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

/**
 * 模糊匹配字符串
 */
function fuzzyMatch(text: string, query: string): boolean {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  let queryIndex = 0;
  for (let i = 0; i < lowerText.length && queryIndex < lowerQuery.length; i++) {
    if (lowerText[i] === lowerQuery[queryIndex]) {
      queryIndex++;
    }
  }

  return queryIndex === lowerQuery.length;
}

/**
 * 在 JSON 树中搜索节点
 * 支持 JSON Path 或文本模糊匹配
 */
export function searchNodesInTree(
  tree: JsonDiagramTree,
  query: string,
  searchType: 'path' | 'value' | 'both' = 'both'
): SearchResult[] {
  const results: SearchResult[] = [];

  // 如果是路径查询，尝试解析为 JSON Path
  if ((searchType === 'path' || searchType === 'both') && query.includes('.') || query.includes('[')) {
    const queryParts = parseJsonPath(query);
    tree.nodes.forEach((node) => {
      const nodeParts = parseJsonPath(node.data.path);
      // 检查是否匹配或包含
      if (nodeParts.length >= queryParts.length) {
        let matches = true;
        for (let i = 0; i < queryParts.length; i++) {
          if (nodeParts[i] !== queryParts[i]) {
            matches = false;
            break;
          }
        }
        if (matches) {
          results.push({
            nodeId: node.id,
            path: node.data.path,
            matchType: 'path',
            parentNodeIds: getAncestorNodeIds(tree, node.id),
          });
        }
      }
    });
  }

  // 文本模糊匹配
  if (searchType === 'value' || searchType === 'both') {
    tree.nodes.forEach((node) => {
      const path = node.data.path;
      const value = String(node.data.value || '');

      if (fuzzyMatch(path, query) || fuzzyMatch(value, query)) {
        // 避免重复添加
        if (
          !results.find(
            (r) => r.nodeId === node.id && r.matchType === 'value'
          )
        ) {
          results.push({
            nodeId: node.id,
            path: node.data.path,
            matchType: 'value',
            parentNodeIds: getAncestorNodeIds(tree, node.id),
          });
        }
      }
    });
  }

  return results;
}

/**
 * 获取节点的所有祖先节点 ID
 */
function getAncestorNodeIds(tree: JsonDiagramTree, nodeId: string): string[] {
  const ancestors: string[] = [];
  let current = tree.nodeMap.get(nodeId);

  while (current && current.data.parentNodeId) {
    ancestors.unshift(current.data.parentNodeId);
    current = tree.nodeMap.get(current.data.parentNodeId);
  }

  return ancestors;
}

/**
 * 根据搜索结果高亮节点
 * 返回需要高亮的节点 ID 集合
 */
export function getHighlightedNodeIds(searchResults: SearchResult[]): Set<string> {
  const highlightedIds = new Set<string>();

  searchResults.forEach((result) => {
    highlightedIds.add(result.nodeId);
    // 也高亮祖先节点路径
    result.parentNodeIds.forEach((id) => {
      highlightedIds.add(id);
    });
  });

  return highlightedIds;
}

/**
 * 过滤节点：根据谓词函数
 */
export function filterNodes(
  tree: JsonDiagramTree,
  predicate: (node: SeaNode) => boolean
): SeaNode[] {
  return tree.nodes.filter(predicate);
}

/**
 * 获取指定深度的所有节点
 */
export function getNodesAtDepth(
  tree: JsonDiagramTree,
  depth: number
): SeaNode[] {
  return tree.nodes.filter((node) => node.data.depth === depth);
}

/**
 * 获取节点的所有子节点
 */
export function getChildNodes(
  tree: JsonDiagramTree,
  parentNodeId: string
): SeaNode[] {
  return tree.nodes.filter((node) => node.data.parentNodeId === parentNodeId);
}
