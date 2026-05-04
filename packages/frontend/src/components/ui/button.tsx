import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium tracking-tight transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-foreground text-background hover:bg-foreground/90 shadow-[0_1px_0_0_rgba(255,255,255,0.15)_inset,0_8px_24px_-12px_rgba(0,0,0,0.6)]",
        primary:
          "bg-gradient-to-b from-[hsl(28_60%_60%)] to-[hsl(24_70%_48%)] text-background shadow-[0_1px_0_0_rgba(255,255,255,0.25)_inset,0_10px_28px_-10px_hsl(24_70%_45%/0.6)] hover:brightness-110",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-border/70 bg-card/30 text-foreground backdrop-blur-md hover:border-border hover:bg-card/60",
        secondary:
          "bg-secondary/70 text-secondary-foreground hover:bg-secondary backdrop-blur-md border border-border/40",
        ghost:
          "text-muted-foreground hover:bg-card/60 hover:text-foreground",
        link:
          "text-foreground underline-offset-4 hover:underline",
        bull:
          "bg-bull/15 text-bull border border-bull/30 hover:bg-bull/25 hover:border-bull/50 backdrop-blur-md shadow-[0_0_24px_-8px_hsl(var(--bull)/0.4)]",
        bear:
          "bg-bear/15 text-bear border border-bear/30 hover:bg-bear/25 hover:border-bear/50 backdrop-blur-md shadow-[0_0_24px_-8px_hsl(var(--bear)/0.4)]",
      },
      size: {
        default: "h-10 px-5",
        sm: "h-8 px-3.5 text-xs",
        lg: "h-12 px-7 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
  },
);
Button.displayName = "Button";

export { buttonVariants };
