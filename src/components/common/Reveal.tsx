import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * Fade-and-rise wrapper for entry reveals. Honors reduced-motion by rendering
 * statically. Pass `index` inside a list to cascade the reveal.
 */
export function Reveal({
  index = 0,
  className,
  children,
  ...props
}: HTMLMotionProps<"div"> & { index?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE, delay: reduce ? 0 : index * 0.05 }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/** Three-dot pulsing indicator for a pending assistant turn. */
export function TypingDots() {
  const reduce = useReducedMotion();
  if (reduce) {
    return <span className="text-muted-foreground">正在生成…</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="正在生成">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-muted-foreground"
          animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
          transition={{
            duration: 0.9,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.15,
          }}
        />
      ))}
    </span>
  );
}
