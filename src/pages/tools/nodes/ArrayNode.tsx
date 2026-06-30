import { memo, CSSProperties } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { List } from 'lucide-react';
import { SeaNodeData } from '../types/json-diagram';

interface ArrayNodeProps extends NodeProps<SeaNodeData> {
  isSelected?: boolean;
  isHighlighted?: boolean;
}

export const ArrayNode = memo(function ArrayNode({
  data,
  isSelected,
  isHighlighted,
}: ArrayNodeProps) {
  const nodeStyle: CSSProperties = {
    padding: '8px 12px',
    borderRadius: '6px',
    border: `2px solid ${
      isSelected ? '#10b981' : isHighlighted ? '#fbbf24' : '#e5e7eb'
    }`,
    backgroundColor: isSelected
      ? '#f0fdf4'
      : isHighlighted
      ? '#fffbeb'
      : '#f9fafb',
    minWidth: '120px',
    maxWidth: '200px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    boxShadow: isSelected
      ? '0 0 0 3px rgba(16, 185, 129, 0.1)'
      : isHighlighted
      ? '0 0 0 3px rgba(251, 191, 36, 0.1)'
      : 'none',
    transition: 'all 0.2s ease',
  };

  const keyStyle: CSSProperties = {
    color: '#6b7280',
    fontWeight: '500',
    marginBottom: '4px',
  };

  const countStyle: CSSProperties = {
    color: '#9ca3af',
    fontSize: '11px',
    marginTop: '2px',
  };

  return (
    <div style={nodeStyle} className="array-node">
      <Handle type="target" position={Position.Left} />

      <div style={keyStyle}>
        <List
          size={14}
          style={{
            display: 'inline',
            marginRight: '4px',
            verticalAlign: 'text-bottom',
          }}
        />
        Array
      </div>

      <div style={countStyle}>
        [{data.childrenCount}]
      </div>

      {data.isLimited && (
        <div style={{ color: '#ef4444', fontSize: '11px', marginTop: '4px' }}>
          Depth limited
        </div>
      )}

      <Handle type="source" position={Position.Right} />
    </div>
  );
});

ArrayNode.displayName = 'ArrayNode';
