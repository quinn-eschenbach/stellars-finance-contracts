import { forwardRef, useMemo, type CSSProperties, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type SliderProps = InputHTMLAttributes<HTMLInputElement> & {
  min?: number;
  max?: number;
  step?: number;
};

/**
 * Native range input styled to match the design system, with the portion
 * left of the thumb filled in the primary color. Computes the fill % from
 * value/min/max and pipes it into a CSS variable consumed by `background`.
 */
export const Slider = forwardRef<HTMLInputElement, SliderProps>(
  ({ className, style, min = 0, max = 100, value, defaultValue, ...props }, ref) => {
    const numericValue = Number(value ?? defaultValue ?? min);
    const range = Number(max) - Number(min);
    const pct = useMemo(() => {
      if (!Number.isFinite(numericValue) || range <= 0) return 0;
      return Math.min(100, Math.max(0, ((numericValue - Number(min)) / range) * 100));
    }, [numericValue, min, range]);

    const fillStyle = {
      ...style,
      background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${pct}%, hsl(var(--secondary)) ${pct}%, hsl(var(--secondary)) 100%)`,
    } as CSSProperties;

    return (
      <input
        type="range"
        ref={ref}
        min={min}
        max={max}
        value={value}
        defaultValue={defaultValue}
        style={fillStyle}
        className={cn(
          "h-1.5 w-full appearance-none rounded-full outline-none",
          "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:cursor-pointer",
          "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:cursor-pointer",
          className,
        )}
        {...props}
      />
    );
  },
);
Slider.displayName = "Slider";
