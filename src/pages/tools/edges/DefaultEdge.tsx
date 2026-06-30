import { memo } from 'react';
import {
  BaseEdge,
  EdgeProps,
  getBezierPath,
} from 'reactflow';
import type { CSSProperties } from 'react';

interface DefaultEdgeProps extends EdgeProps {
  isHighlighted?: boolean;
}

export const DefaultEdge = memo(function DefaultEdge(props: DefaultEdgeProps) {
  const {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style,
    isHighlighted,
  } = props;

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const edgeStyle: CSSProperties = {
    ...style,
    stroke: isHighlighted ? '#3b82f6' : '#d1d5db',
    strokeWidth: isHighlighted ? 2 : 1.5,
    opacity: isHighlighted ? 1 : 0.6,
    transition: 'all 0.2s ease',
  };

  return (
    <>
      <BaseEdge path={edgePath} style={edgeStyle} />
    </>
  );
});

DefaultEdge.displayName = 'DefaultEdge';
