import { useCallback } from "react";
import { cn } from "@/lib/utils";

export interface ResizeHandleProps {
  /** Called with the horizontal delta (px) from the drag start position. */
  onDrag: (deltaX: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
  /** Optional double-click action, e.g. reset to default width. */
  onReset?: () => void;
  className?: string;
  title?: string;
}

/**
 * A thin vertical drag strip for resizing an adjacent panel. Reports the
 * horizontal delta from where the drag started; the consumer owns the base
 * width and clamping so the same handle works on either edge of a panel.
 *
 * Listens on `window` during the drag (with pointer capture semantics) so the
 * gesture keeps tracking even if the cursor leaves the 1px strip.
 */
export function ResizeHandle({
  onDrag,
  onStart,
  onEnd,
  onReset,
  className,
  title,
}: ResizeHandleProps) {
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only react to the primary (left) button.
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      onStart?.();
      const move = (ev: PointerEvent) => onDrag(ev.clientX - startX);
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        onEnd?.();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [onDrag, onStart, onEnd]
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title={title}
      onPointerDown={handlePointerDown}
      onDoubleClick={onReset}
      className={cn(
        "group/resize relative z-20 flex w-1.5 shrink-0 cursor-col-resize touch-none items-stretch justify-center",
        className
      )}
    >
      <span className="h-full w-px bg-transparent transition-colors group-hover/resize:bg-accent/60 group-active/resize:bg-accent" />
    </div>
  );
}
