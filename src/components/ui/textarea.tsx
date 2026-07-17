import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cn(
          "flex min-h-[72px] w-full rounded-sm border border-input bg-background px-3 py-2 text-label-14 text-foreground transition-[color,border-color,box-shadow] duration-150 ease-geist",
          "hover:border-muted-foreground/40",
          "placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:border-input focus-visible:shadow-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
