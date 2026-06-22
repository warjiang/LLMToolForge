import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, checked, defaultChecked, onCheckedChange, ...props }, ref) => {
  const reduce = useReducedMotion();
  const isControlled = checked !== undefined;
  const [internal, setInternal] = React.useState(defaultChecked ?? false);
  const on = isControlled ? checked : internal;

  const handleChange = (next: boolean) => {
    if (!isControlled) setInternal(next);
    onCheckedChange?.(next);
  };

  return (
    <SwitchPrimitives.Root
      ref={ref}
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={handleChange}
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-geist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:bg-accent data-[state=unchecked]:bg-muted",
        className
      )}
      {...props}
    >
      <SwitchPrimitives.Thumb asChild>
        <motion.span
          className="pointer-events-none block h-4 w-4 rounded-full bg-white shadow-geist-sm ring-0"
          initial={false}
          animate={{ x: on ? 16 : 0 }}
          transition={
            reduce
              ? { duration: 0 }
              : { type: "spring", stiffness: 600, damping: 30, mass: 0.6 }
          }
        />
      </SwitchPrimitives.Thumb>
    </SwitchPrimitives.Root>
  );
});
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
