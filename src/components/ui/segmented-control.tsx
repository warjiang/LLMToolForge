import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = {
  value: T;
  label: React.ReactNode;
};

type SegmentedControlProps<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: "sm" | "md";
  "aria-label"?: string;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  size = "md",
  ...props
}: SegmentedControlProps<T>) {
  const reduce = useReducedMotion();
  const layoutId = React.useId();

  return (
    <div
      role="tablist"
      aria-label={props["aria-label"]}
      className={cn(
        "inline-flex items-center rounded-md border border-border bg-background-secondary p-0.5",
        className
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative whitespace-nowrap rounded-sm font-medium transition-[color,box-shadow] duration-200 ease-geist focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--ring)]",
              size === "md"
                ? "px-3.5 py-1.5 text-label-13"
                : "px-3 py-1 text-label-12",
              active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {active && (
              <motion.span
                layoutId={`${layoutId}-seg`}
                className="absolute inset-0 rounded-sm bg-background shadow-geist-sm"
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 420, damping: 34 }
                }
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
