import { forwardRef, type LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "text-xs leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:text-[#848584]",
        className,
      )}
      {...props}
    />
  ),
);
Label.displayName = "Label";
