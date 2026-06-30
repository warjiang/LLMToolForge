'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Download, X } from 'lucide-react';
import { JsonDiagramCore } from './JsonDiagramCore';
import { SeaNode, SeaEdge, SearchResult } from '../types/json-diagram';
import { parseJsonToNodes } from '../utils/jsonParser';
import { layoutNodesWithDagre, layoutNodesManually } from '../utils/jsonLayout';
import { searchNodesInTree } from '../utils/searchUtils';
import { exportDiagramAsImage } from '../utils/exportUtils';

interface JsonDiagramProps {
  jsonInput: string;
  maxDepth?: number;
}

interface NodeDetailData {
  nodeId: string;
  path: string;
  value: unknown;
  dataType: string;
}

export const JsonDiagram = React.memo(function JsonDiagram({
  jsonInput,
  maxDepth = 3,
}: JsonDiagramProps) {
  const diagramRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNode, setSelectedNode] = useState<NodeDetailData | null>(null);
  const [currentDepth, setCurrentDepth] = useState(maxDepth);
  const [exporting, setExporting] = useState(false);

  // 解析并布局 JSON
  const diagramData = useMemo(() => {
    if (!jsonInput.trim()) {
      return { nodes: [] as SeaNode[], edges: [] as SeaEdge[], error: null };
    }

    try {
      const parsed = JSON.parse(jsonInput);
      const tempTree = parseJsonToNodes(parsed, currentDepth);

      // 使用 Dagre 进行布局
      let layoutedNodes: SeaNode[] = [];
      try {
        layoutedNodes = layoutNodesWithDagre(tempTree.nodes, tempTree.edges);
      } catch (layoutError) {
        console.warn('⚠ Dagre 布局失败，使用备用方案:', layoutError);
        layoutedNodes = layoutNodesManually(tempTree.nodes);
      }

      return {
        nodes: layoutedNodes,
        edges: tempTree.edges,
        error: null,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'JSON 解析失败';
      return {
        nodes: [],
        edges: [],
        error: errorMsg,
      };
    }
  }, [jsonInput, currentDepth]);

  // 搜索功能
  const searchResults: SearchResult[] = useMemo(() => {
    if (!searchQuery.trim() || diagramData.nodes.length === 0) {
      return [];
    }

    const nodeMap = new Map(diagramData.nodes.map((n) => [n.id, n]));
    return searchNodesInTree(
      { nodes: diagramData.nodes, edges: diagramData.edges, nodeMap },
      searchQuery,
      'both'
    );
  }, [searchQuery, diagramData]);

  const handleNodeClick = useCallback((nodeId: string) => {
    const node = diagramData.nodes.find((n) => n.id === nodeId);
    if (node) {
      setSelectedNode({
        nodeId,
        path: node.data.path,
        value: node.data.value,
        dataType: node.data.dataType,
      });
    }
  }, [diagramData.nodes]);

  const handleExportPng = useCallback(async () => {
    if (!diagramRef.current) return;
    try {
      setExporting(true);
      await exportDiagramAsImage(diagramRef.current, {
        format: 'png',
        quality: 1,
      });
    } catch (error) {
      console.error('导出失败:', error);
    } finally {
      setExporting(false);
    }
  }, []);

  const handleExportSvg = useCallback(async () => {
    if (!diagramRef.current) return;
    try {
      setExporting(true);
      await exportDiagramAsImage(diagramRef.current, {
        format: 'svg',
      });
    } catch (error) {
      console.error('导出失败:', error);
    } finally {
      setExporting(false);
    }
  }, []);

  return (
    <div className="flex min-h-[36rem] flex-col gap-4">
      {/* 工具栏 */}
      <div className="space-y-2 border-b border-border pb-3">
        {/* 搜索栏 */}
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground">
              按路径或值搜索
            </Label>
            <Input
              type="text"
              placeholder="例如: $.user.name 或搜索文本..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="mt-1 h-8 text-xs"
              disabled={diagramData.nodes.length === 0}
            />
          </div>
          {searchQuery && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSearchQuery('')}
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* 控制栏 */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">
              最大深度:
            </Label>
            <input
              type="range"
              min="1"
              max="10"
              value={currentDepth}
              onChange={(e) => setCurrentDepth(parseInt(e.target.value))}
              className="w-24"
            />
            <span className="text-xs text-muted-foreground">{currentDepth}</span>
          </div>

          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleExportPng}
              disabled={diagramData.nodes.length === 0 || exporting}
              title="导出为 PNG"
              className="h-8"
            >
              <Download className="h-4 w-4" />
              PNG
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleExportSvg}
              disabled={diagramData.nodes.length === 0 || exporting}
              title="导出为 SVG"
              className="h-8"
            >
              <Download className="h-4 w-4" />
              SVG
            </Button>
          </div>
        </div>

        {/* 搜索结果统计 */}
        {searchQuery && (
          <div className="text-xs text-muted-foreground">
            找到 {searchResults.length} 个匹配
          </div>
        )}
      </div>

      {/* 图表容器 */}
      <div
        ref={diagramRef}
        className="h-[32rem] min-h-[24rem] w-full overflow-hidden rounded-md border border-border bg-background-secondary"
      >
        {diagramData.error ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-destructive">解析错误</p>
              <p className="text-xs text-muted-foreground">{diagramData.error}</p>
            </div>
          </div>
        ) : diagramData.nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">没有数据可显示</p>
          </div>
        ) : (
          <JsonDiagramCore
            nodes={diagramData.nodes}
            edges={diagramData.edges}
            searchResults={searchResults}
            onNodeClick={handleNodeClick}
            loading={false}
          />
        )}
      </div>

      {/* 节点详情弹窗 */}
      {selectedNode && (
        <Dialog open={true} onOpenChange={() => setSelectedNode(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>节点详情</DialogTitle>
              <DialogDescription>路径: {selectedNode.path}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs font-semibold">类型</Label>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedNode.dataType}
                </p>
              </div>
              <div>
                <Label className="text-xs font-semibold">值</Label>
                <pre className="mt-1 max-h-32 overflow-auto rounded bg-background p-2 text-xs">
                  {JSON.stringify(selectedNode.value, null, 2)}
                </pre>
              </div>
              <div>
                <Label className="text-xs font-semibold">路径</Label>
                <p className="mt-1 break-all font-mono text-xs">
                  {selectedNode.path}
                </p>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
});

JsonDiagram.displayName = 'JsonDiagram';
