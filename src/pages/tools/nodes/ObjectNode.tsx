import { memo, CSSProperties } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { ChevronRight } from 'lucide-react';
import { SeaNodeData } from '../types/json-diagram';

interface ObjectNodeProps extends NodeProps<SeaNodeData> {
  isSelected?: boolean;
  isHighlighted?: boolean;
}

export const ObjectNode = memo(function ObjectNode({
  data,
  isSelected,
  isHighlighted,
}: ObjectNodeProps) {
  const nodeStyle: CSSProperties = {
    padding: '8px 12px',
    borderRadius: '6px',
    border: `2px solid ${
      isSelected ? '#3b82f6' : isHighlighted ? '#fbbf24' : '#e5e7eb'
    }`,
    backgroundColor: isSelected
      ? '#eff6ff'
      : isHighlighted
      ? '#fffbeb'
      : '#f9fafb',
    minWidth: '120px',
    maxWidth: '200px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    boxShadow: isSelected
      ? '0 0 0 3px rgba(59, 130, 246, 0.1)'
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
    <div style={nodeStyle} className="object-node">
      <Handle type="target" position={Position.Left} />

      <div style={keyStyle}>
        <ChevronRight
          size={14}
          style={{
            display: 'inline',
            marginRight: '4px',
            verticalAlign: 'text-bottom',
          }}
        />
        Object
      </div>

      <div style={countStyle}>
        {data.childrenCount} item{(data.childrenCount ?? 0) > 1 ? 's' : ''}
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

ObjectNode.displayName = 'ObjectNode';
