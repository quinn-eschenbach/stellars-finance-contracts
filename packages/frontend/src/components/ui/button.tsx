import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Button as R95Button } from "react95";
import { cn } from "@/lib/utils";

type Variant =
  | "default"
  | "primary"
  | "destructive"
  | "outline"
  | "secondary"
  | "ghost"
  | "link"
  | "bull"
  | "bear";

type Size = "default" | "sm" | "lg" | "icon";

const SIZE_MAP = { default: "md", sm: "sm", lg: "lg", icon: "md" } as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Renders the button in its pressed (toggled-on) state. */
  active?: boolean;
  fullWidth?: boolean;
}

/**
 * react95 Button with the app's variant vocabulary. `ghost`/`link` map to the
 * flat toolbar style; `bull`/`bear`/`destructive` keep the silver chrome and
 * color the label instead — Win95 never had colored buttons.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => (
    <R95Button
      ref={ref}
      primary={variant === "primary"}
      variant={variant === "ghost" || variant === "link" ? "thin" : "default"}
      size={SIZE_MAP[size]}
      square={size === "icon"}
      className={cn(
        variant === "bull" && "!font-bold !text-bull",
        variant === "bear" && "!font-bold !text-bear",
        variant === "destructive" && "!font-bold !text-destructive",
        variant === "link" && "!underline",
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
