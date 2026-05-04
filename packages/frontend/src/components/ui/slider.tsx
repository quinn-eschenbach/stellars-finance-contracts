import { forwardRef, useMemo, type CSSProperties, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type SliderProps = InputHTMLAttributes<HTMLInputElement> & {
  min?: number;
  max?: number;
  step?: number;
};

/**
 * Native range input styled to match the design system, with the portion
 * left of the thumb filled by an ember gradient. Computes the fill % from
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
      background: `linear-gradient(to right, hsl(28 70% 58%) 0%, hsl(24 65% 50%) ${pct}%, hsl(30 6% 18% / 0.9) ${pct}%, hsl(30 6% 18% / 0.9) 100%)`,
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
          "h-2 w-full appearance-none rounded-full outline-none border border-border/40 transition-all",
          "[&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
          "[&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:cursor-grab active:[&::-webkit-slider-thumb]:cursor-grabbing",
          "[&::-webkit-slider-thumb]:shadow-[0_0_0_2px_hsl(24_70%_50%/0.6),0_0_18px_-2px_hsl(24_70%_55%/0.7),inset_0_-2px_4px_-1px_rgba(0,0,0,0.3)]",
          "[&::-webkit-slider-thumb]:transition-transform hover:[&::-webkit-slider-thumb]:scale-110",
          "[&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground [&::-moz-range-thumb]:cursor-grab",
          "[&::-moz-range-thumb]:shadow-[0_0_0_2px_hsl(24_70%_50%/0.6),0_0_18px_-2px_hsl(24_70%_55%/0.7)]",
          className,
        )}
        {...props}
      />
    );
  },
);
Slider.displayName = "Slider";
