import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Plain native range input styled to match the design system. Sufficient for
 * leverage / amount sliders without pulling in a Radix Slider primitive.
 */
export const Slider = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { min?: number; max?: number; step?: number }
>(({ className, ...props }, ref) => (
  <input
    type="range"
    ref={ref}
    className={cn(
      "h-1.5 w-full appearance-none rounded-full bg-secondary accent-primary outline-none",
      "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary",
      className,
    )}
    {...props}
  />
));
Slider.displayName = "Slider";
