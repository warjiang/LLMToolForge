import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import ReactFlow, {
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MiniMap,
  ReactFlowInstance,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { NodeType, JsonDataType, SeaNode, SeaEdge } from '../types/json-diagram';
import { getHighlightedNodeIds } from '../utils/searchUtils';
import { SearchResult } from '../types/json-diagram';

interface JsonDiagramCoreProps {
  nodes: SeaNode[];
  edges: SeaEdge[];
  searchResults?: SearchResult[];
  onNodeClick?: (nodeId: string) => void;
  loading?: boolean;
}

function getNodeLabel(node: SeaNode): string {
  if (node.type === NodeType.Object) {
    return `${node.data.path}\nObject (${node.data.childrenCount ?? 0})`;
  }

  if (node.type === NodeType.Array) {
    return `${node.data.path}\nArray [${node.data.childrenCount ?? 0}]`;
  }

  const value =
    node.data.dataType === JsonDataType.String
      ? `"${String(node.data.value)}"`
      : String(node.data.value);

  return `${node.data.path}\n${value}`;
}

export const JsonDiagramCore = React.memo(function JsonDiagramCore({
  nodes: inputNodes,
  edges: inputEdges,
  searchResults = [],
  onNodeClick,
  loading = false,
}: JsonDiagramCoreProps) {
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(inputNodes);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(inputEdges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [reactFlowInstance, setReactFlowInstance] =
    useState<ReactFlowInstance | null>(null);

  const highlightedNodeIds = useMemo(
    () => getHighlightedNodeIds(searchResults),
    [searchResults]
  );

  const renderNodes = useMemo(
    () =>
      flowNodes.map((node) => {
        const isSelected = node.id === selectedNodeId;
        const isHighlighted = highlightedNodeIds.has(node.id);

        return {
          ...node,
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          data: {
            ...node.data,
            label: getNodeLabel(node),
          },
          style: {
            minWidth: 180,
            maxWidth: 260,
            whiteSpace: 'pre-wrap',
            fontSize: 12,
            lineHeight: 1.4,
            borderRadius: 10,
            border: `2px solid ${
              isSelected ? '#3b82f6' : isHighlighted ? '#fbbf24' : '#d1d5db'
            }`,
            background:
              node.type === NodeType.Object
                ? '#eff6ff'
                : node.type === NodeType.Array
                ? '#f0fdf4'
                : '#f9fafb',
            color: '#111827',
            padding: '10px 12px',
            boxShadow: isSelected
              ? '0 0 0 3px rgba(59, 130, 246, 0.12)'
              : isHighlighted
              ? '0 0 0 3px rgba(251, 191, 36, 0.12)'
              : '0 1px 2px rgba(15, 23, 42, 0.06)',
          },
        };
      }),
    [flowNodes, highlightedNodeIds, selectedNodeId]
  );

  // 同步输入节点和边 - 当 inputNodes 或 inputEdges 改变时更新
  useEffect(() => {
    setFlowNodes(inputNodes);
  }, [inputNodes, setFlowNodes]);

  useEffect(() => {
    setFlowEdges(inputEdges);
  }, [inputEdges, setFlowEdges]);

  useEffect(() => {
    if (!reactFlowInstance || inputNodes.length === 0) {
      return;
    }

    requestAnimationFrame(() => {
      reactFlowInstance.fitView({
        padding: 0.2,
        includeHiddenNodes: true,
      });
    });
  }, [inputNodes, reactFlowInstance]);

  const handleNodeClick = useCallback(
    (_event: any, node: any) => {
      setSelectedNodeId(node.id);
      onNodeClick?.(node.id);
    },
    [onNodeClick]
  );

  if (loading) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f9fafb',
          fontSize: '14px',
          color: '#9ca3af',
        }}
      >
        加载中...
      </div>
    );
  }

  if (flowNodes.length === 0) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f9fafb',
          fontSize: '14px',
          color: '#9ca3af',
        }}
      >
        没有节点显示
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={renderNodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onInit={setReactFlowInstance}
        fitView
        fitViewOptions={{ padding: 0.2, includeHiddenNodes: true }}
      >
        <Background color="#aaa" gap={16} />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            if (node.id === selectedNodeId) return '#3b82f6';
            if (highlightedNodeIds.has(node.id)) return '#fbbf24';
            if (node.type === NodeType.Object) return '#dbeafe';
            if (node.type === NodeType.Array) return '#dcfce7';
            return '#f3f4f6';
          }}
          maskColor="rgba(0, 0, 0, 0.1)"
        />
      </ReactFlow>
    </div>
  );
});

JsonDiagramCore.displayName = 'JsonDiagramCore';
