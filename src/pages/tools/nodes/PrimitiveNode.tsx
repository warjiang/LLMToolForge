import { memo, CSSProperties } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { SeaNodeData, JsonDataType } from '../types/json-diagram';

interface PrimitiveNodeProps extends NodeProps<SeaNodeData> {
  isSelected?: boolean;
  isHighlighted?: boolean;
}

function getTypeColor(dataType: JsonDataType): string {
  switch (dataType) {
    case JsonDataType.String:
      return '#059669';
    case JsonDataType.Number:
      return '#d97706';
    case JsonDataType.Boolean:
      return '#dc2626';
    case JsonDataType.Null:
      return '#6b7280';
    default:
      return '#6b7280';
  }
}

function formatValue(value: unknown, dataType: JsonDataType): string {
  if (dataType === JsonDataType.String) {
    const str = String(value);
    return str.length > 30 ? str.substring(0, 27) + '...' : str;
  }
  if (dataType === JsonDataType.Null) {
    return 'null';
  }
  const str = String(value);
  return str.length > 30 ? str.substring(0, 27) + '...' : str;
}

export const PrimitiveNode = memo(function PrimitiveNode({
  data,
  isSelected,
  isHighlighted,
}: PrimitiveNodeProps) {
  const typeColor = getTypeColor(data.dataType);

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

  const typeStyle: CSSProperties = {
    color: typeColor,
    fontWeight: '500',
    fontSize: '11px',
    marginBottom: '4px',
    textTransform: 'uppercase',
  };

  const valueStyle: CSSProperties = {
    color: '#1f2937',
    fontSize: '12px',
    wordBreak: 'break-word',
    marginTop: '2px',
    padding: '4px 0',
  };

  return (
    <div style={nodeStyle} className="primitive-node">
      <Handle type="target" position={Position.Left} />

      <div style={typeStyle}>{data.dataType}</div>

      <div style={valueStyle}>{formatValue(data.value, data.dataType)}</div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
});

PrimitiveNode.displayName = 'PrimitiveNode';
