import { cn } from "@/lib/utils";

interface BiasBarProps {
  longOi: bigint | string;
  shortOi: bigint | string;
  className?: string;
}

/**
 * Slim horizontal bias indicator: full-width gradient track with a marker dot
 * at the current long share. Compact companion to the larger BiasGauge.
 */
export function BiasBar({ longOi, shortOi, className }: BiasBarProps) {
  const long = typeof longOi === "string" ? BigInt(longOi) : longOi;
  const short = typeof shortOi === "string" ? BigInt(shortOi) : shortOi;
  const total = long + short;

  const hasOi = total > 0n;
  const ratio = hasOi ? Number((long * 10000n) / total) / 10000 : 0.5;
  const pct = Math.round(ratio * 100);
  const { label, tone } = classify(ratio, hasOi);

  const labelColor =
    tone === "bull"
      ? "text-bull"
      : tone === "bear"
        ? "text-bear"
        : tone === "neutral"
          ? "text-foreground/85"
          : "text-muted-foreground/60";

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="relative h-[3px] w-full overflow-visible rounded-full">
        <div
          className={cn(
            "absolute inset-0 rounded-full",
            hasOi ? "opacity-70" : "opacity-25",
          )}
          style={{
            background:
              "linear-gradient(90deg, hsl(8 60% 60%) 0%, hsl(36 75% 60%) 50%, hsl(142 28% 55%) 100%)",
          }}
        />
        {hasOi && (
          <div
            className="absolute top-1/2 h-[9px] w-px -translate-x-1/2 -translate-y-1/2 bg-foreground/90"
            style={{ left: `${ratio * 100}%` }}
          />
        )}
      </div>
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "font-mono text-[10px] uppercase tracking-[0.2em]",
            labelColor,
          )}
        >
          {label}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">
          {hasOi ? `${pct}% long` : "no OI"}
        </span>
      </div>
    </div>
  );
}

function classify(
  ratio: number,
  hasOi: boolean,
): { label: string; tone: "bull" | "bear" | "neutral" | "empty" } {
  if (!hasOi) return { label: "—", tone: "empty" };
  if (ratio >= 0.62) return { label: "Bullish", tone: "bull" };
  if (ratio <= 0.38) return { label: "Bearish", tone: "bear" };
  return { label: "Neutral", tone: "neutral" };
}
