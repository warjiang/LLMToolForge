import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm font-medium transition-[transform,color,background-color,opacity,box-shadow] duration-150 ease-geist active:scale-[0.97] focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--ring)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:opacity-90 active:opacity-80",
        secondary:
          "border border-border bg-background text-foreground hover:bg-secondary active:bg-muted",
        tertiary: "text-foreground hover:bg-secondary active:bg-muted",
        destructive:
          "bg-destructive text-destructive-foreground hover:opacity-90 active:opacity-80",
        accent:
          "bg-accent text-accent-foreground hover:opacity-90 active:opacity-80",
        ghost: "text-muted-foreground hover:bg-secondary hover:text-foreground",
      },
      size: {
        sm: "h-7 px-2.5 text-label-13",
        md: "h-9 px-3 text-label-14",
        lg: "h-11 px-4 text-copy-16",
        icon: "h-8 w-8",
        "icon-sm": "h-7 w-7",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
