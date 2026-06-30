import { Edge, Node } from 'reactflow';

/**
 * JSON 数据类型枚举
 */
export enum JsonDataType {
  Object = 'object',
  Array = 'array',
  String = 'string',
  Number = 'number',
  Boolean = 'boolean',
  Null = 'null',
}

/**
 * React Flow 节点类型
 */
export enum NodeType {
  Object = 'object-node',
  Array = 'array-node',
  Primitive = 'primitive-node',
}

/**
 * React Flow 边类型
 */
export enum EdgeType {
  Default = 'default-edge',
  Chain = 'chain-edge',
}

/**
 * 节点数据（存储在 React Flow Node.data 中）
 */
export interface SeaNodeData {
  depth: number;
  path: string;
  dataType: JsonDataType;
  value?: unknown;
  parentNodeId?: string;
  arrayIndex?: number;
  objectKey?: string;
  childrenCount?: number;
  isLimited?: boolean;
}

/**
 * Sea Node（基于 React Flow Node 的扩展）
 */
export type SeaNode = Node<SeaNodeData>;

/**
 * Sea Edge（基于 React Flow Edge 的扩展）
 */
export type SeaEdge = Edge & {
  type?: string;
};

/**
 * JSON 转换结果
 */
export interface JsonDiagramTree {
  nodes: SeaNode[];
  edges: SeaEdge[];
  nodeMap: Map<string, SeaNode>;
}

/**
 * 搜索结果
 */
export interface SearchResult {
  nodeId: string;
  path: string;
  matchType: 'path' | 'value';
  parentNodeIds: string[];
}

/**
 * 导出选项
 */
export interface ExportOptions {
  format: 'png' | 'svg';
  quality?: number;
  width?: number;
  height?: number;
  backgroundColor?: string;
}

/**
 * JSON 解析错误
 */
export class JsonParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonParseError';
  }
}
