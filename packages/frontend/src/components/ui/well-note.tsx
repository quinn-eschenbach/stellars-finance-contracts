import type { ReactNode } from "react";
import { Frame } from "react95";
import { cn } from "@/lib/utils";

/** Sunken Win95 well for empty/loading/info notes — one style, many windows. */
export function WellNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Frame
      variant="well"
      className={cn("!block w-full !px-3 !py-4 text-center text-xs", className)}
    >
      {children}
    </Frame>
  );
}
