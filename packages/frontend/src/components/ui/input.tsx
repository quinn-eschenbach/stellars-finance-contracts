import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-11 w-full rounded-xl border border-border/60 bg-input/60 px-4 py-1 font-mono text-sm tracking-tight backdrop-blur-md transition-all",
        "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03),inset_0_2px_8px_-4px_rgba(0,0,0,0.4)]",
        "placeholder:font-sans placeholder:text-muted-foreground/60",
        "focus-visible:border-primary/50 focus-visible:bg-input/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
