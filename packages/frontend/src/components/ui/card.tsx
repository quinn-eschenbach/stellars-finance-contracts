import { forwardRef, type HTMLAttributes } from "react";
import { Button as R95Button, Window, WindowHeader } from "react95";
import { cn } from "@/lib/utils";

/** Every card is a Win95 window. */
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <Window ref={ref} className={cn("!block w-full", className)} {...props} />
  ),
);
Card.displayName = "Card";

/** Navy title bar with a decorative close control. */
export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <WindowHeader
      ref={ref}
      className={cn("flex !h-auto min-h-[33px] items-center justify-between gap-2 py-1", className)}
      {...props}
    >
      <div className="flex min-w-0 flex-1 flex-col justify-center leading-tight">{children}</div>
      <R95Button aria-hidden tabIndex={-1} className="shrink-0">
        <span className="-mt-0.5 font-bold">×</span>
      </R95Button>
    </WindowHeader>
  ),
);
CardHeader.displayName = "CardHeader";

export const CardTitle = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("truncate text-sm leading-tight", className)} {...props} />
  ),
);
CardTitle.displayName = "CardTitle";

export const CardDescription = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("text-xs font-normal leading-relaxed", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("px-3 py-3", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center px-3 pb-3 pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";
