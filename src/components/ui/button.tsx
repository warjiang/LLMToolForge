import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm font-medium transition-colors duration-150 ease-geist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
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
        sm: "h-8 px-1.5 text-label-13",
        md: "h-10 px-2.5 text-label-14",
        lg: "h-12 px-3.5 text-copy-16",
        icon: "h-9 w-9",
        "icon-sm": "h-8 w-8",
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
